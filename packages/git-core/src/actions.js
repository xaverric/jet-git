import { GitCoreError } from "./errors.js";
import { git } from "./git.js";
import { loadChanges } from "./worktree.js";
import { resolveRoot } from "./repository.js";

function assertHash(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{7,40}$/i.test(value)) {
    throw new GitCoreError("Unsupported commit.", { code: "BAD_REVISION" });
  }
  return value;
}

function assertRef(value) {
  const name = String(value ?? "").trim();
  if (!name || name.startsWith("-") || name.includes("..") || /[\0\n\r^~:?*[\\\s]/.test(name)) {
    throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
  }
  return name;
}

function assertName(value, code) {
  const name = String(value ?? "").trim();
  if (!name || name.startsWith("-") || name.includes("..") || name.includes("\\") || name.includes("\0")) {
    throw new GitCoreError("Name is invalid.", { code });
  }
  return name;
}

async function operationKind(root) {
  const probe = async (rev) => {
    try {
      await git(root, ["rev-parse", "--verify", "--quiet", rev]);
      return true;
    } catch (error) {
      if (error.exitCode === 1) return false;
      throw error;
    }
  };
  if (await probe("REBASE_HEAD")) return "rebase";
  if (await probe("MERGE_HEAD")) return "merge";
  if (await probe("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (await probe("REVERT_HEAD")) return "revert";
  return null;
}

export async function revertCommit(root, hash) {
  const resolved = await resolveRoot(root);
  await git(resolved, ["revert", "--no-edit", assertHash(hash)]);
  return { hash: (await git(resolved, ["rev-parse", "--verify", "HEAD"])).trim() };
}

export async function cherryPick(root, hash) {
  const resolved = await resolveRoot(root);
  await git(resolved, ["cherry-pick", assertHash(hash)]);
  return { hash: (await git(resolved, ["rev-parse", "--verify", "HEAD"])).trim() };
}

export async function rebaseOnto(root, upstream) {
  const resolved = await resolveRoot(root);
  await git(resolved, ["rebase", assertRef(upstream)]);
  return { upstream };
}

export async function mergeRef(root, ref) {
  const resolved = await resolveRoot(root);
  await git(resolved, ["merge", "--no-edit", assertRef(ref)]);
  return { ref };
}

export async function squashCommits(root, hashes, message) {
  const resolved = await resolveRoot(root);
  const selected = [...new Set((Array.isArray(hashes) ? hashes : []).map(assertHash))];
  const text = String(message ?? "").trim();
  if (selected.length < 2 || selected.length > 50) {
    throw new GitCoreError("Squash needs between 2 and 50 commits.", { code: "BAD_LIMIT" });
  }
  if (!text) throw new GitCoreError("Squash needs a commit message.", { code: "BAD_REVISION" });
  if (await operationKind(resolved)) {
    throw new GitCoreError("Finish or abort the current rebase, merge, cherry-pick or revert first.", { code: "CONFLICT" });
  }
  const changes = await loadChanges(resolved);
  if (changes.files.length > 0) {
    throw new GitCoreError("Commit or stash local changes before squashing.", { code: "DIRTY" });
  }
  let branch = "";
  try {
    branch = (await git(resolved, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch {
    throw new GitCoreError("Squash works on the current branch.", { code: "BAD_REVISION" });
  }
  const history = (await git(resolved, ["rev-list", "--first-parent", "-n", "2000", "HEAD"])).trim().split("\n").filter(Boolean);
  const positions = selected.map((hash) => history.indexOf(hash));
  if (positions.some((index) => index < 0)) {
    throw new GitCoreError("These commits are not on the current branch, or they are older than the last 2000 commits.", { code: "BAD_REVISION" });
  }
  positions.sort((left, right) => left - right);
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] !== positions[index - 1] + 1) {
      throw new GitCoreError("Select a continuous range of commits on the current branch.", { code: "BAD_REVISION" });
    }
  }
  const newest = history[positions[0]];
  const oldest = history[positions[positions.length - 1]];
  let parent = "";
  try {
    parent = (await git(resolved, ["rev-parse", "--verify", `${oldest}^`])).trim();
  } catch (error) {
    if (error instanceof GitCoreError) {
      throw new GitCoreError("Squash cannot include the root commit.", { code: "BAD_REVISION" });
    }
    throw error;
  }
  const merges = (await git(resolved, ["rev-list", "--merges", `${parent}..HEAD`])).trim();
  if (merges) throw new GitCoreError("A merge commit sits between the selection and HEAD.", { code: "BAD_REVISION" });
  if (newest === history[0]) {
    await git(resolved, ["reset", "--soft", parent]);
    await git(resolved, ["commit", "-m", text]);
  } else {
    await git(resolved, ["switch", "--detach", newest]);
    try {
      await git(resolved, ["reset", "--soft", parent]);
      await git(resolved, ["commit", "-m", text]);
      await git(resolved, ["rebase", "--onto", "HEAD", newest, branch]);
    } catch (error) {
      await git(resolved, ["rebase", "--abort"]).catch(() => {});
      await git(resolved, ["switch", "--force", branch]).catch(() => {});
      throw error;
    }
  }
  return { hash: (await git(resolved, ["rev-parse", "--verify", "HEAD"])).trim(), squashed: selected.length };
}

export async function fetchRemotes(root) {
  const resolved = await resolveRoot(root);
  await git(resolved, ["fetch", "--all", "--prune"]);
  return { fetched: true };
}

export async function stashSave(root, message = "") {
  const resolved = await resolveRoot(root);
  const text = String(message ?? "").trim();
  const args = ["stash", "push", "-u"];
  if (text) args.push("-m", text);
  await git(resolved, args);
  return { stashed: true };
}

export async function stashPop(root) {
  const resolved = await resolveRoot(root);
  await git(resolved, ["stash", "pop"]);
  return { popped: true };
}

export async function discardPath(root, file) {
  const resolved = await resolveRoot(root);
  const changes = await loadChanges(resolved);
  const known = changes.files.find((item) => item.path === file);
  if (!known) throw new GitCoreError("File is not part of the local changes.", { code: "BAD_PATH" });
  if (known.untracked) await git(resolved, ["clean", "-f", "--", file]);
  else await git(resolved, ["restore", "--source=HEAD", "--staged", "--worktree", "--", file]);
  return loadChanges(resolved);
}

export async function deleteBranch(root, ref) {
  const resolved = await resolveRoot(root);
  const name = assertName(String(ref ?? "").replace(/^refs\/heads\//, ""), "INVALID_BRANCH");
  let head = "";
  try {
    head = (await git(resolved, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
  }
  if (head === name) throw new GitCoreError("Cannot delete the current branch.", { code: "INVALID_BRANCH" });
  await git(resolved, ["branch", "-d", name]);
  return { name };
}

export async function createTag(root, name, hash) {
  const resolved = await resolveRoot(root);
  const tag = assertName(name, "INVALID_BRANCH");
  await git(resolved, ["check-ref-format", `refs/tags/${tag}`]);
  const args = ["tag", tag];
  if (hash) args.push(assertHash(hash));
  await git(resolved, args);
  return { name: tag };
}

export async function deleteTag(root, name) {
  const resolved = await resolveRoot(root);
  const tag = assertName(String(name ?? "").replace(/^refs\/tags\//, ""), "INVALID_BRANCH");
  await git(resolved, ["tag", "-d", tag]);
  return { name: tag };
}

export async function resolveSide(root, file, side) {
  const resolved = await resolveRoot(root);
  const flag = side === "ours" ? "--ours" : side === "theirs" ? "--theirs" : "";
  if (!flag) throw new GitCoreError("Choose ours or theirs.", { code: "BAD_PATH" });
  const changes = await loadChanges(resolved);
  if (!changes.conflict.files.includes(file)) {
    throw new GitCoreError("File is not in conflict.", { code: "BAD_PATH" });
  }
  await git(resolved, ["checkout", flag, "--", file]);
  await git(resolved, ["add", "--", file]);
  return loadChanges(resolved);
}

export async function continueOperation(root) {
  const resolved = await resolveRoot(root);
  const kind = await operationKind(resolved);
  if (kind === "rebase") await git(resolved, ["-c", "core.editor=true", "rebase", "--continue"]);
  else if (kind === "merge") await git(resolved, ["merge", "--continue"]);
  else if (kind === "cherry-pick") await git(resolved, ["-c", "core.editor=true", "cherry-pick", "--continue"]);
  else if (kind === "revert") await git(resolved, ["-c", "core.editor=true", "revert", "--continue"]);
  else throw new GitCoreError("Nothing to continue.", { code: "GIT_ERROR" });
  return { kind };
}

export async function resetTo(root, hash, mode) {
  const resolved = await resolveRoot(root);
  const flag = mode === "soft" ? "--soft" : mode === "hard" ? "--hard" : "--mixed";
  if (!["soft", "mixed", "hard"].includes(mode)) {
    throw new GitCoreError("Reset mode must be soft, mixed or hard.", { code: "BAD_REVISION" });
  }
  await git(resolved, ["reset", flag, assertHash(hash)]);
  return { hash, mode: flag };
}

export async function dropCommits(root, hashes) {
  const resolved = await resolveRoot(root);
  const list = (Array.isArray(hashes) ? hashes : [hashes]).map(assertHash);
  if (list.length === 0 || list.length > 50) throw new GitCoreError("Choose commits to drop.", { code: "BAD_REVISION" });
  const head = (await git(resolved, ["rev-parse", "--verify", "HEAD"])).trim();
  if (list[0] === head) {
    for (let index = 0; index < list.length; index += 1) {
      const at = (await git(resolved, ["rev-parse", "--verify", `HEAD~${index}`])).trim();
      if (at !== list[index]) throw new GitCoreError("Drop a continuous range from HEAD.", { code: "BAD_REVISION" });
    }
    await git(resolved, ["reset", "--mixed", `HEAD~${list.length}`]);
    return { dropped: list.length };
  }
  if (list.length !== 1) throw new GitCoreError("Drop one commit, or a range starting at HEAD.", { code: "BAD_REVISION" });
  const parent = (await git(resolved, ["rev-parse", "--verify", `${list[0]}^`])).trim();
  await git(resolved, ["rebase", "--onto", parent, list[0]]);
  return { dropped: 1 };
}

export async function pushUpTo(root, hash) {
  const resolved = await resolveRoot(root);
  const commit = assertHash(hash);
  let branch = "";
  try {
    branch = (await git(resolved, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
  }
  if (!branch) throw new GitCoreError("Detached HEAD cannot be pushed.", { code: "INVALID_BRANCH" });
  let remote = "origin";
  try {
    const upstream = (await git(resolved, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).trim();
    remote = upstream.split("/")[0] || remote;
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
  }
  await git(resolved, ["push", remote, `${commit}:refs/heads/${branch}`]);
  return { remote, branch, hash: commit };
}

export async function createPatch(root, hashes) {
  const resolved = await resolveRoot(root);
  const list = (Array.isArray(hashes) ? hashes : [hashes]).map(assertHash);
  if (list.length === 0) throw new GitCoreError("Choose a commit.", { code: "BAD_REVISION" });
  if (list.length === 1) return git(resolved, ["format-patch", "--stdout", "-1", list[0]]);
  const oldest = list[list.length - 1];
  const newest = list[0];
  try {
    return await git(resolved, ["format-patch", "--stdout", `${oldest}^..${newest}`]);
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
    return git(resolved, ["format-patch", "--stdout", "--root", oldest, newest]);
  }
}

export async function revertCommits(root, hashes) {
  const resolved = await resolveRoot(root);
  const list = (Array.isArray(hashes) ? hashes : [hashes]).map(assertHash);
  if (list.length === 0) throw new GitCoreError("Choose a commit.", { code: "BAD_REVISION" });
  await git(resolved, ["revert", "--no-edit", ...list.slice().reverse()]);
  return { hash: (await git(resolved, ["rev-parse", "--verify", "HEAD"])).trim() };
}

export async function abortOperation(root) {
  const resolved = await resolveRoot(root);
  const kind = await operationKind(resolved);
  if (kind === "rebase") await git(resolved, ["rebase", "--abort"]);
  else if (kind === "merge") await git(resolved, ["merge", "--abort"]);
  else if (kind === "cherry-pick") await git(resolved, ["cherry-pick", "--abort"]);
  else if (kind === "revert") await git(resolved, ["revert", "--abort"]);
  else throw new GitCoreError("Nothing to abort.", { code: "GIT_ERROR" });
  return { kind };
}
