import { readFile } from "node:fs/promises";
import path from "node:path";
import { GitCoreError } from "./errors.js";
import { git } from "./git.js";
import { addedFileView, parseUnifiedDiff } from "./patch.js";
import { resolveRoot } from "./repository.js";

const MAX_DIFF = 200_000;

function parseHeader(body) {
  if (body.startsWith("HEAD (no branch)")) {
    return { branch: null, detached: true, upstream: null, ahead: 0, behind: 0 };
  }
  const fresh = /^No commits yet on (.+)$/.exec(body);
  if (fresh) return { branch: fresh[1], detached: false, upstream: null, ahead: 0, behind: 0 };
  const match = /^(.*?)(?:\.\.\.(.*?))?(?: \[(.*)\])?$/.exec(body);
  const extra = match?.[3] ?? "";
  return {
    branch: match?.[1] || null,
    detached: false,
    upstream: match?.[2] || null,
    ahead: Number(/ahead (\d+)/.exec(extra)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(extra)?.[1] ?? 0),
  };
}

export function parseStatus(text) {
  const records = text.split("\0").filter((item) => item.length > 0);
  const header = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0 };
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith("## ")) {
      Object.assign(header, parseHeader(record.slice(3)));
      continue;
    }
    if (record.length < 4 || record[2] !== " ") continue;
    const stagedCode = record[0];
    const worktreeCode = record[1];
    const renamed = stagedCode === "R" || stagedCode === "C" || worktreeCode === "R" || worktreeCode === "C";
    if (renamed) index += 1;
    files.push({
      path: record.slice(3),
      index: stagedCode,
      worktree: worktreeCode,
      staged: stagedCode !== " " && stagedCode !== "?",
      unstaged: worktreeCode !== " " && worktreeCode !== "?",
      untracked: stagedCode === "?" && worktreeCode === "?",
      status: stagedCode === "?" ? "?" : (worktreeCode !== " " ? worktreeCode : stagedCode),
    });
  }
  return { ...header, files };
}

function assertStart(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.startsWith("-") || value.includes("..")) {
    throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
  }
  const allowed = /^(refs\/(heads|remotes|tags)\/[^\0\n\r^~:?*[\\]+|[0-9a-f]{7,40})$/i.test(value);
  if (!allowed) throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
  return value;
}

async function changedFile(root, file) {
  const changes = await loadChanges(root);
  const known = changes.files.find((item) => item.path === file);
  if (!known) throw new GitCoreError("File is not part of the local changes.", { code: "BAD_PATH" });
  return known;
}

const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

async function refExists(root, rev) {
  try {
    await git(root, ["rev-parse", "--verify", "--quiet", rev]);
    return true;
  } catch (error) {
    if (error.exitCode === 1) return false;
    throw error;
  }
}

async function readConflict(root, files) {
  const [merging, rebasing, cherryPicking, reverting] = await Promise.all([
    refExists(root, "MERGE_HEAD"),
    refExists(root, "REBASE_HEAD"),
    refExists(root, "CHERRY_PICK_HEAD"),
    refExists(root, "REVERT_HEAD"),
  ]);
  const kind = rebasing ? "rebase" : merging ? "merge" : cherryPicking ? "cherry-pick" : reverting ? "revert" : null;
  return {
    kind,
    files: files.filter((file) => UNMERGED.has(`${file.index}${file.worktree}`)).map((file) => file.path),
  };
}

function insideRoot(root, file) {
  const absolute = path.resolve(root, file);
  const base = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (absolute !== root && !absolute.startsWith(base)) {
    throw new GitCoreError("Unsupported path.", { code: "BAD_PATH" });
  }
  return absolute;
}

export async function loadChanges(root) {
  const resolved = await resolveRoot(root);
  const text = await git(resolved, ["status", "--porcelain=v1", "-b", "-z"]);
  const parsed = parseStatus(text);
  return { root: resolved, ...parsed, conflict: await readConflict(resolved, parsed.files) };
}

export async function loadWorkingDiff(root, file) {
  const resolved = await resolveRoot(root);
  const known = await changedFile(resolved, file);
  if (known.untracked || known.status === "A" || known.index === "A") {
    try {
      const buffer = await readFile(insideRoot(resolved, file));
      if (buffer.includes(0)) return { path: file, binary: true, single: true, rows: [], size: buffer.length };
      return { path: file, ...addedFileView(buffer.toString("utf8"), MAX_DIFF) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { path: file, binary: false, single: true, missing: true, rows: [] };
    }
  }
  const text = await git(resolved, ["diff", "HEAD", "--no-color", "--", file]);
  if (text.length > MAX_DIFF) return { path: file, binary: false, truncated: true, rows: [] };
  const parsed = parseUnifiedDiff(text);
  const single = !parsed.rows.some((row) => row.kind === "del" || row.kind === "change" || row.kind === "context");
  return { path: file, truncated: false, single, ...parsed };
}

export async function setStaged(root, file, staged) {
  const resolved = await resolveRoot(root);
  await changedFile(resolved, file);
  if (staged) await git(resolved, ["add", "--", file]);
  else await git(resolved, ["restore", "--staged", "--", file]);
  return loadChanges(resolved);
}

export async function commitChanges(root, { message = "", amend = false } = {}) {
  const resolved = await resolveRoot(root);
  const text = String(message).replace(/\r\n/g, "\n").trim();
  if (text.includes("\0")) throw new GitCoreError("Commit message is invalid.", { code: "EMPTY_MESSAGE" });
  if (!text && !amend) throw new GitCoreError("Commit message is empty.", { code: "EMPTY_MESSAGE" });
  const args = ["commit"];
  if (amend) args.push("--amend");
  args.push(text ? "-m" : "--no-edit", ...(text ? [text] : []));
  await git(resolved, args);
  const hash = (await git(resolved, ["rev-parse", "--verify", "HEAD"])).trim();
  return { hash };
}

export async function createBranch(root, name, start) {
  const resolved = await resolveRoot(root);
  const branch = String(name ?? "").trim();
  if (!branch) throw new GitCoreError("Branch name is empty.", { code: "INVALID_BRANCH" });
  await git(resolved, ["check-ref-format", "--branch", branch]);
  const point = assertStart(start);
  const args = ["switch", "-c", branch];
  if (point) args.push(point);
  await git(resolved, args);
  return { name: branch };
}

export async function pushHead(root) {
  const resolved = await resolveRoot(root);
  const changes = await loadChanges(resolved);
  if (changes.detached || !changes.branch) {
    throw new GitCoreError("Checkout a branch before pushing.", { code: "DETACHED" });
  }
  if (changes.upstream) await git(resolved, ["push"]);
  else await git(resolved, ["push", "-u", "origin", "HEAD"]);
  return loadChanges(resolved);
}

export async function pullHead(root) {
  const resolved = await resolveRoot(root);
  await git(resolved, ["pull"]);
  return loadChanges(resolved);
}
