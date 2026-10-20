import { GitCoreError } from "./errors.js";
import { git } from "./git.js";
import { parseNameStatus } from "./parse.js";
import { addedFileView, parseUnifiedDiff, splitDiffFiles } from "./patch.js";
import { loadCommitDetail, resolveRoot } from "./repository.js";

const MAX_COMMITS = 100;
const MAX_DIFF = 200_000;
const MAX_PREFETCH = 4_000_000;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function assertHashes(hashes) {
  if (!Array.isArray(hashes) || hashes.length === 0 || hashes.length > MAX_COMMITS) {
    throw new GitCoreError("Select between 1 and 100 commits.", { code: "BAD_REVISION" });
  }
  return hashes.map((hash) => {
    if (typeof hash !== "string" || !/^[0-9a-f]{7,40}$/i.test(hash)) {
      throw new GitCoreError("Unsupported commit.", { code: "BAD_REVISION" });
    }
    return hash.toLowerCase();
  });
}

function combineStatus(current, next) {
  const kind = String(next ?? "M")[0];
  if (!current) return kind;
  if (kind === "D") return "D";
  if (kind === "A") return current === "D" ? "A" : current;
  if (current === "D") return "A";
  return current === "A" ? "A" : "M";
}

export function mergeFileStatuses(groups) {
  const order = [];
  const status = new Map();
  for (const files of groups) {
    for (const file of files) {
      if (!status.has(file.path)) order.push(file.path);
      status.set(file.path, combineStatus(status.get(file.path), file.status));
    }
  }
  return order.map((path) => ({ path, status: status.get(path) }));
}

async function changedFiles(root, newestFirst) {
  const groups = await Promise.all([...newestFirst].reverse().map(async (hash) => {
    const text = await git(root, [
      "show",
      "--first-parent",
      "--name-status",
      "--format=",
      "--no-renames",
      "-z",
      hash,
    ]);
    return parseNameStatus(text);
  }));
  return mergeFileStatuses(groups);
}

async function containedBranches(root, hash) {
  const text = await git(root, [
    "for-each-ref",
    "--contains",
    hash,
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);
  const locals = [];
  const remotes = [];
  for (const ref of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
    if (ref.startsWith("refs/heads/")) locals.push(ref.slice("refs/heads/".length));
    if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD")) remotes.push(ref.slice("refs/remotes/".length));
  }
  let onHead = false;
  try {
    await git(root, ["merge-base", "--is-ancestor", hash, "HEAD"]);
    onHead = true;
  } catch (error) {
    if (error.exitCode !== 1) throw error;
  }
  const names = [];
  if (onHead) names.push("HEAD");
  names.push(...locals.sort((left, right) => left.localeCompare(right)));
  names.push(...remotes.sort((left, right) => left.localeCompare(right)));
  return names;
}

async function selectionPatch(root, list) {
  const newest = list[0];
  const oldest = list[list.length - 1];
  let base = EMPTY_TREE;
  try {
    base = (await git(root, ["rev-parse", "--verify", `${oldest}^`])).trim();
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
  }
  try {
    const text = await git(root, ["diff", "--no-color", "--no-renames", base, newest]);
    if (text.length > MAX_PREFETCH) return {};
    return splitDiffFiles(text, MAX_DIFF);
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
    return {};
  }
}

export async function loadSelection(root, hashes, focus) {
  const resolved = await resolveRoot(root);
  const list = assertHashes(hashes);
  const selected = focus == null || focus === "" ? list[0] : assertHashes([focus])[0];
  if (!list.includes(selected)) throw new GitCoreError("Unsupported commit.", { code: "BAD_REVISION" });
  const [files, commit, branches, patch] = await Promise.all([
    changedFiles(resolved, list),
    loadCommitDetail(resolved, selected),
    containedBranches(resolved, selected),
    selectionPatch(resolved, list),
  ]);
  const diffs = {};
  for (const file of files) {
    if (patch[file.path]) diffs[file.path] = { path: file.path, ...patch[file.path] };
  }
  return { files, commit: { ...commit, branches }, diffs };
}

function assertListedFile(file, files) {
  if (typeof file !== "string" || file.length === 0 || file.includes("\0") || file.split("/").includes("..")) {
    throw new GitCoreError("Unsupported path.", { code: "BAD_PATH" });
  }
  if (!files.some((item) => item.path === file)) {
    throw new GitCoreError("File is not part of this change.", { code: "BAD_PATH" });
  }
}

export async function loadSelectionDiff(root, hashes, file) {
  const resolved = await resolveRoot(root);
  const list = assertHashes(hashes);
  const files = await changedFiles(resolved, list);
  assertListedFile(file, files);
  const newest = list[0];
  const oldest = list[list.length - 1];
  let base = EMPTY_TREE;
  try {
    base = (await git(resolved, ["rev-parse", "--verify", `${oldest}^`])).trim();
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
  }
  const known = files.find((item) => item.path === file);
  if (known?.status === "A") {
    try {
      const raw = await git(resolved, ["cat-file", "-p", `${newest}:${file}`]);
      return { path: file, ...addedFileView(raw, MAX_DIFF) };
    } catch (error) {
      if (error.code !== "GIT_ERROR") throw error;
    }
  }
  const text = await git(resolved, ["diff", "--no-color", base, newest, "--", file]);
  if (text.length > MAX_DIFF) return { path: file, binary: false, truncated: true, rows: [] };
  const parsed = parseUnifiedDiff(text);
  const single = !parsed.rows.some((row) => row.kind === "del" || row.kind === "change" || row.kind === "context");
  return { path: file, truncated: false, single, ...parsed };
}
