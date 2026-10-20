import { GitCoreError } from "./errors.js";
import { git } from "./git.js";
import { resolveRoot } from "./repository.js";

export const REVIEW_FORMAT = "jet-git-review";
export const REVIEW_PATH = ".jet-git/review.json";

function assertBranch(branch) {
  if (typeof branch !== "string" || !branch || branch.startsWith("-") || branch.startsWith("revision/") || branch.includes("..")) {
    throw new GitCoreError("Review needs a normal branch.", { code: "BAD_REVISION" });
  }
  return branch;
}

export function revisionBranch(branch) {
  return `revision/${assertBranch(branch)}`;
}

function assertHead(head) {
  if (typeof head !== "string" || !/^[0-9a-f]{7,40}$/i.test(head)) {
    throw new GitCoreError("Review needs the reviewed commit.", { code: "BAD_REVISION" });
  }
  return head;
}

function assertComment(comment, index) {
  const path = comment?.path;
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes("..") || path.includes("\0")) {
    throw new GitCoreError(`Review comment ${index + 1} has a bad path.`, { code: "BAD_PATH" });
  }
  if (comment.side !== "old" && comment.side !== "new") {
    throw new GitCoreError(`Review comment ${index + 1} has a bad side.`, { code: "BAD_REVISION" });
  }
  const start = comment.start;
  const end = comment.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 500) {
    throw new GitCoreError(`Review comment ${index + 1} has a bad line range.`, { code: "BAD_REVISION" });
  }
  const body = String(comment.body ?? "").trim();
  if (!body || body.length > 8000) {
    throw new GitCoreError(`Review comment ${index + 1} needs a short text.`, { code: "BAD_REVISION" });
  }
  const id = String(comment.id ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    throw new GitCoreError(`Review comment ${index + 1} has a bad id.`, { code: "BAD_REVISION" });
  }
  const createdAt = String(comment.createdAt ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(createdAt)) {
    throw new GitCoreError(`Review comment ${index + 1} has a bad time.`, { code: "BAD_REVISION" });
  }
  return { id, path, side: comment.side, start, end, body, createdAt };
}

export function normalizeReview(input, branch, head) {
  const comments = Array.isArray(input?.comments) ? input.comments : null;
  if (!comments || comments.length > 500) {
    throw new GitCoreError("Review comments are missing.", { code: "BAD_REVISION" });
  }
  const seen = new Set();
  const normalized = comments.map((comment, index) => {
    const item = assertComment(comment, index);
    if (seen.has(item.id)) throw new GitCoreError("Review comment ids must be unique.", { code: "BAD_REVISION" });
    seen.add(item.id);
    return item;
  });
  return {
    format: REVIEW_FORMAT,
    version: 1,
    branch,
    head,
    comments: normalized,
  };
}

async function currentBranch(root) {
  try {
    return assertBranch((await git(root, ["symbolic-ref", "--short", "HEAD"])).trim());
  } catch (error) {
    if (error instanceof GitCoreError) {
      throw new GitCoreError("Review works on the current branch.", { code: "BAD_REVISION" });
    }
    throw error;
  }
}

function parseEntries(stdout) {
  const entries = [];
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, hash] = record.slice(0, tab).split(" ");
    entries.push({ mode, type, hash, name: record.slice(tab + 1) });
  }
  return entries;
}

async function entries(root, tree) {
  try {
    return parseEntries(await git(root, ["ls-tree", "-z", tree]));
  } catch (error) {
    if (error instanceof GitCoreError && /not a tree|Not a valid object name/i.test(error.message)) return [];
    throw error;
  }
}

function treeInput(items) {
  return items
    .slice()
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((item) => `${item.mode} ${item.type} ${item.hash}\t${item.name}\n`)
    .join("");
}

async function treeWithReview(root, baseTree, blob) {
  const rootEntries = await entries(root, baseTree);
  const folder = rootEntries.find((item) => item.name === ".jet-git" && item.type === "tree");
  const nested = folder ? await entries(root, folder.hash) : [];
  const files = nested.filter((item) => item.name !== "review.json");
  files.push({ mode: "100644", type: "blob", hash: blob, name: "review.json" });
  const folderTree = (await git(root, ["mktree"], { input: treeInput(files) })).trim();
  const next = rootEntries.filter((item) => item.name !== ".jet-git");
  next.push({ mode: "040000", type: "tree", hash: folderTree, name: ".jet-git" });
  return (await git(root, ["mktree"], { input: treeInput(next) })).trim();
}

export async function loadReview(root) {
  const resolved = await resolveRoot(root);
  const branch = await currentBranch(resolved);
  const revision = revisionBranch(branch);
  let text = "";
  try {
    text = await git(resolved, ["show", `refs/heads/${revision}:${REVIEW_PATH}`]);
  } catch (error) {
    if (error instanceof GitCoreError) return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GitCoreError("Stored review is not valid JSON.", { code: "BAD_REVISION" });
  }
  if (parsed?.format !== REVIEW_FORMAT || parsed.version !== 1) {
    throw new GitCoreError("Stored review uses an unknown format.", { code: "BAD_REVISION" });
  }
  return { ...normalizeReview(parsed, branch, assertHead(parsed.head)), revisionBranch: revision };
}

export async function commitReview(root, input) {
  const resolved = await resolveRoot(root);
  const branch = await currentBranch(resolved);
  const revision = revisionBranch(branch);
  await git(resolved, ["check-ref-format", "--branch", revision]);
  const head = assertHead(input?.head);
  try {
    await git(resolved, ["merge-base", "--is-ancestor", head, "HEAD"]);
  } catch (error) {
    if (error instanceof GitCoreError) {
      throw new GitCoreError("Reviewed commit is not on the current branch.", { code: "BAD_REVISION" });
    }
    throw error;
  }
  const document = normalizeReview(input, branch, head);
  const blob = (await git(resolved, ["hash-object", "-w", "--stdin"], { input: `${JSON.stringify(document, null, 2)}\n` })).trim();
  const base = (await git(resolved, ["rev-parse", `${head}^{tree}`])).trim();
  const tree = await treeWithReview(resolved, base, blob);
  let parent = head;
  try {
    const previous = (await git(resolved, ["rev-parse", "--verify", `refs/heads/${revision}`])).trim();
    const previousParent = (await git(resolved, ["rev-parse", "--verify", `${previous}^`])).trim();
    if (previousParent === head) parent = previous;
  } catch (error) {
    if (!(error instanceof GitCoreError)) throw error;
  }
  const commit = (await git(resolved, ["commit-tree", tree, "-p", parent, "-m", `Review ${branch}`])).trim();
  await git(resolved, ["update-ref", `refs/heads/${revision}`, commit]);
  return { revisionBranch: revision, commit, head };
}
