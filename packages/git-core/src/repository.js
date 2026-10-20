import path from "node:path";
import { GitCoreError } from "./errors.js";
import { formatLocation, git, gitAll, parseLocation } from "./git.js";
import { layoutGraph } from "./layout.js";
import { LOG_FORMAT, parseLog, parseNameStatus } from "./parse.js";
import { parseUnifiedDiff } from "./patch.js";
import { buildBranchPanel, parseRefRecords } from "./refs.js";

const DEFAULT_LIMIT = 400;
const MAX_LIMIT = 5000;
const REF_FORMAT = "%(objectname)%09%(*objectname)%09%(creatordate:unix)%09%(refname)%09%(if)%(HEAD)%(then)1%(else)0%(end)";

function normalizeLimit(value) {
  const limit = Number.isInteger(value) ? value : DEFAULT_LIMIT;
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new GitCoreError("Commit limit is out of range.", { code: "BAD_LIMIT" });
  }
  return limit;
}

function normalizeRev(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.startsWith("-") || value.includes("..")) {
    throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
  }
  const allowed = /^(refs\/(heads|remotes|tags)\/[^\0\n\r^~:?*[\\]+|[0-9a-f]{7,40})$/i.test(value);
  if (!allowed) throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
  return value;
}

function normalizeAuthor(value) {
  if (value == null || String(value).trim() === "") return null;
  const author = String(value).trim();
  if (author.includes("\0") || author.includes("\n") || author.startsWith("-")) {
    throw new GitCoreError("Unsupported author.", { code: "BAD_REVISION" });
  }
  return author;
}

function normalizeWhen(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?$/.test(text)) return text.replace(" ", "T");
  throw new GitCoreError("Unsupported date.", { code: "BAD_REVISION" });
}

function historyArgs({ author, since, until }) {
  const args = [];
  if (author) args.push(`--author=${author}`);
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);
  return args;
}

function normalizePath(value) {
  if (value == null || value.trim() === "") return null;
  if (typeof value !== "string" || value.includes("\0")) {
    throw new GitCoreError("Unsupported path.", { code: "BAD_PATH" });
  }
  const pathspec = value.trim();
  return pathspec.startsWith("-") ? `./${pathspec}` : pathspec;
}

function normalizeHash(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{7,40}$/i.test(value)) {
    throw new GitCoreError("Unsupported commit.", { code: "BAD_REVISION" });
  }
  return value;
}

function emptyHistory(error) {
  return /does not have any commits|bad default revision|your current branch .* does not have any commits/i.test(error.message);
}

async function readLog(cwd, { rev, pathspec, limit, extraArgs = [] }) {
  const args = ["log", "-z", "--date-order", `-n`, String(limit), `--pretty=format:${LOG_FORMAT}`, ...extraArgs];
  args.push(rev ?? "--all");
  if (pathspec) args.push("--", pathspec);
  try {
    return parseLog(await git(cwd, args));
  } catch (error) {
    if (error instanceof GitCoreError && emptyHistory(error)) return [];
    throw error;
  }
}

async function readCommits(cwd, { rev, pathspec, search, author, since, until, limit }) {
  const range = historyArgs({ author, since, until });
  if (!search) {
    const items = await readLog(cwd, { rev, pathspec, limit: limit + 1, extraArgs: range });
    return { items: items.slice(0, limit), truncated: items.length > limit };
  }

  const pattern = search;
  const [byMessage, byAuthor] = await Promise.all([
    readLog(cwd, { rev, pathspec, limit: limit + 1, extraArgs: ["-i", "-F", `--grep=${pattern}`, ...range] }),
    readLog(cwd, { rev, pathspec, limit: limit + 1, extraArgs: ["-i", "-F", `--author=${pattern}`, ...range] }),
  ]);
  const merged = new Map();
  for (const commit of [...byMessage, ...byAuthor]) merged.set(commit.hash, commit);

  if (/^[0-9a-f]{4,40}$/i.test(search)) {
    try {
      const hash = (await git(cwd, ["rev-parse", "--verify", `${search}^{commit}`])).trim();
      if (!merged.has(hash)) {
        const [exact] = await readLog(cwd, { rev: hash, pathspec, limit: 1 });
        if (exact) merged.set(exact.hash, exact);
      }
    } catch (error) {
      if (!(error instanceof GitCoreError)) throw error;
    }
  }

  const items = [...merged.values()].sort((left, right) => (left.authoredAt < right.authoredAt ? 1 : -1));
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

export async function resolveRoot(inputPath) {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new GitCoreError("Repository path is missing.", { code: "NOT_A_REPOSITORY" });
  }
  const location = parseLocation(inputPath);
  try {
    const top = (await git(inputPath, ["rev-parse", "--show-toplevel"])).trim();
    return formatLocation(location.host, top);
  } catch (error) {
    if (error instanceof GitCoreError && error.code === "GIT_NOT_FOUND") throw error;
    throw new GitCoreError("Not a git repository.", { code: "NOT_A_REPOSITORY" });
  }
}

async function readHead(cwd) {
  let name = null;
  let detached = false;
  try {
    name = (await git(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch (error) {
    if (error instanceof GitCoreError && error.code === "GIT_NOT_FOUND") throw error;
    detached = true;
  }
  let hash = null;
  try {
    hash = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  } catch (error) {
    if (error instanceof GitCoreError && error.code === "GIT_NOT_FOUND") throw error;
    hash = null;
  }
  return { name, hash, detached };
}

async function readRefs(cwd) {
  const stdout = await git(cwd, ["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"]);
  return parseRefRecords(stdout);
}

/**
 * @param {string} inputPath
 * @param {{ rev?: string, search?: string, path?: string, limit?: number }} [options]
 */
function normalizedQuery(options) {
  const limit = normalizeLimit(options.limit);
  const rev = normalizeRev(options.rev);
  const pathspec = normalizePath(options.path);
  const author = normalizeAuthor(options.author);
  const since = normalizeWhen(options.since);
  const until = normalizeWhen(options.until);
  const search = typeof options.search === "string" ? options.search.trim() : "";
  if (search.includes("\0") || search.includes("\n")) {
    throw new GitCoreError("Unsupported search.", { code: "BAD_REVISION" });
  }
  return { limit, rev, pathspec, author, since, until, search };
}

async function loadOneFast(inputPath, query) {
  const location = parseLocation(inputPath);
  const log = ["log", "-z", "--date-order", "-n", String(query.limit + 1), `--pretty=format:${LOG_FORMAT}`, ...historyArgs(query), query.rev ?? "--all"];
  if (query.pathspec) log.push("--", query.pathspec);
  const [top, headRef, headHash, refs, commits] = await gitAll(inputPath, [
    ["rev-parse", "--show-toplevel"],
    ["symbolic-ref", "--short", "HEAD"],
    ["rev-parse", "HEAD"],
    ["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"],
    log,
  ]);
  if (top.code !== 0) throw new GitCoreError("Not a git repository.", { code: "NOT_A_REPOSITORY" });
  const root = formatLocation(location.host, top.stdout.trim());
  const detached = headRef.code !== 0;
  const head = {
    name: detached ? null : headRef.stdout.trim(),
    hash: headHash.code === 0 ? headHash.stdout.trim() : null,
    detached,
  };
  if (refs.code !== 0) throw new GitCoreError((refs.stderr || "git refs failed").trim(), { code: "GIT_ERROR" });
  let items = [];
  if (commits.code === 0) items = parseLog(commits.stdout);
  else if (!emptyHistory({ message: commits.stderr })) {
    throw new GitCoreError((commits.stderr || "git log failed").trim(), { code: "GIT_ERROR" });
  }
  return {
    root,
    head,
    branches: buildBranchPanel(parseRefRecords(refs.stdout), head),
    commits: items.slice(0, query.limit),
    authors: [...new Set(items.map((commit) => commit.authorName).filter(Boolean))],
    truncated: items.length > query.limit,
    rev: query.rev,
    limit: query.limit,
  };
}

async function loadOne(inputPath, options) {
  const query = normalizedQuery(options);
  if (parseLocation(inputPath).host && !query.search) return loadOneFast(inputPath, query);
  const root = await resolveRoot(inputPath);
  const [head, records, commits] = await Promise.all([
    readHead(root),
    readRefs(root),
    readCommits(root, query),
  ]);
  return {
    root,
    head,
    branches: buildBranchPanel(records, head),
    commits: commits.items,
    authors: [...new Set(commits.items.map((commit) => commit.authorName).filter(Boolean))],
    truncated: commits.truncated,
    rev: query.rev,
    limit: query.limit,
  };
}

function mergedAuthors(views) {
  return [...new Set(views.flatMap((view) => view.authors ?? []))].sort((left, right) => left.localeCompare(right));
}

function repoName(root) {
  return path.posix.basename(parseLocation(root).path);
}

function missingRevision(error) {
  return error instanceof GitCoreError && error.code === "GIT_ERROR"
    && /unknown revision|bad revision|ambiguous argument|invalid object name/i.test(error.message);
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function loadRepositoryView(inputPath, options = {}) {
  const one = await loadOne(inputPath, options);
  return {
    root: one.root,
    head: one.head,
    branches: one.branches,
    rows: layoutGraph(one.commits),
    truncated: one.truncated,
    rev: one.rev,
    limit: one.limit,
  };
}

export async function loadWorkspaceView(roots, options = {}) {
  const unique = [...new Set((roots ?? []).filter((item) => typeof item === "string" && item.trim()))];
  if (unique.length === 0) throw new GitCoreError("Repository path is missing.", { code: "NOT_A_REPOSITORY" });
  const parts = await mapPool(unique, 6, async (root) => {
    try {
      return await loadOne(root, options);
    } catch (error) {
      if (unique.length > 1 && missingRevision(error)) return null;
      throw error;
    }
  });
  const views = parts.filter(Boolean);
  if (views.length === 0) throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
  const repos = views.map((view) => ({
    root: view.root,
    name: repoName(view.root),
    head: view.head,
    branches: view.branches,
  }));
  if (views.length === 1) {
    const view = views[0];
    return {
      root: view.root,
      head: view.head,
      branches: view.branches,
      rows: layoutGraph(view.commits).map((row) => ({ ...row, root: view.root, repo: repoName(view.root) })),
      authors: mergedAuthors(views),
      truncated: view.truncated,
      rev: view.rev,
      limit: view.limit,
      repos,
    };
  }
  const merged = views.flatMap((view) => view.commits.map((commit) => ({
    ...commit,
    root: view.root,
    repo: repoName(view.root),
  })));
  merged.sort((left, right) => (left.authoredAt < right.authoredAt ? 1 : -1));
  const limit = views[0].limit;
  return {
    root: views[0].root,
    head: views[0].head,
    branches: views[0].branches,
    rows: layoutGraph(merged.slice(0, limit)),
    authors: mergedAuthors(views),
    truncated: merged.length > limit || views.some((view) => view.truncated),
    rev: views[0].rev,
    limit,
    repos,
  };
}

/**
 * @param {string} root
 * @param {string} hash
 */
export async function loadCommitDetail(root, hash) {
  const resolvedRoot = await resolveRoot(root);
  const commit = normalizeHash(hash);
  const [record] = await readLog(resolvedRoot, { rev: commit, pathspec: null, limit: 1 });
  if (!record) throw new GitCoreError("Commit was not found.", { code: "BAD_REVISION" });
  const files = parseNameStatus(await git(resolvedRoot, [
    "show",
    "--first-parent",
    "--name-status",
    "--format=",
    "--no-renames",
    "-z",
    commit,
  ]));
  return { ...record, files };
}

/**
 * @param {string} root
 * @param {string} hash
 * @param {string} file
 */
export async function loadFileDiff(root, hash, file) {
  const resolvedRoot = await resolveRoot(root);
  const detail = await loadCommitDetail(resolvedRoot, hash);
  if (typeof file !== "string" || file.length === 0 || file.includes("\0") || file.split("/").includes("..")) {
    throw new GitCoreError("Unsupported path.", { code: "BAD_PATH" });
  }
  const known = detail.files.some((item) => item.path === file);
  if (!known) throw new GitCoreError("File is not part of this commit.", { code: "BAD_PATH" });
  const diff = await git(resolvedRoot, ["show", "--first-parent", "--no-color", "--format=", detail.hash, "--", file]);
  const limit = 200_000;
  const truncated = diff.length > limit;
  const text = truncated ? diff.slice(0, limit) : diff;
  const parsed = parseUnifiedDiff(text);
  return { path: file, truncated, text, ...parsed };
}
