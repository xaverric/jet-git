import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import {
  cherryPick,
  createTag,
  deleteBranch,
  deleteTag,
  discardPath,
  rebaseOnto,
  revertCommit,
  squashCommits,
  stashPop,
  stashSave,
} from "../src/actions.js";
import { loadSelectionDiff } from "../src/selection.js";
import { loadWorkingDiff } from "../src/worktree.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args) {
  return execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
}

async function configure(dir) {
  await runGit(dir, ["config", "user.name", "Test"]);
  await runGit(dir, ["config", "user.email", "test@example.com"]);
  await runGit(dir, ["config", "commit.gpgsign", "false"]);
}

test("shows the full text of an added file and can revert, cherry-pick, stash and squash", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-actions-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await configure(dir);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "first"]);
    const first = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(dir, "a.txt"), "two\n");
    await writeFile(path.join(dir, "new.txt"), "fresh line\n");
    await runGit(dir, ["add", "a.txt", "new.txt"]);
    await runGit(dir, ["commit", "-m", "second"]);
    const second = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    const added = await loadSelectionDiff(dir, [second], "new.txt");
    assert.equal(added.single, true);
    assert.equal(added.rows.some((row) => row.kind === "add" && row.text === "fresh line"), true);

    await writeFile(path.join(dir, "loose.txt"), "loose\n");
    const loose = await loadWorkingDiff(dir, "loose.txt");
    assert.equal(loose.single, true);
    assert.equal(loose.rows.some((row) => row.text === "loose"), true);
    await stashSave(dir, "wip");
    assert.equal(await readFile(path.join(dir, "loose.txt"), "utf8").catch(() => ""), "");
    await stashPop(dir);
    assert.equal(await readFile(path.join(dir, "loose.txt"), "utf8"), "loose\n");
    await discardPath(dir, "loose.txt");

    await revertCommit(dir, second);
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "one\n");
    await runGit(dir, ["switch", "-c", "feature", first]);
    await cherryPick(dir, second);
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "two\n");
    await runGit(dir, ["switch", "main"]);
    await runGit(dir, ["branch", "gone", first]);
    await deleteBranch(dir, "refs/heads/gone");

    await createTag(dir, "v1", first);
    await deleteTag(dir, "refs/tags/v1");

    await writeFile(path.join(dir, "a.txt"), "three\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "third"]);
    const third = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    const reverted = (await runGit(dir, ["rev-parse", "HEAD~1"])).stdout.trim();
    await squashCommits(dir, [third, reverted], "joined");
    const left = Number((await runGit(dir, ["rev-list", "--count", "HEAD"])).stdout.trim());
    assert.equal(left, 3);
    assert.equal((await runGit(dir, ["log", "-1", "--format=%s"])).stdout.trim(), "joined");
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "three\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("squashes a continuous range that is not at the branch tip", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-squash-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await configure(dir);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "base"]);
    await writeFile(path.join(dir, "a.txt"), "two\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "left"]);
    const left = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(dir, "b.txt"), "bee\n");
    await runGit(dir, ["add", "b.txt"]);
    await runGit(dir, ["commit", "-m", "right"]);
    const right = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(dir, "c.txt"), "see\n");
    await runGit(dir, ["add", "c.txt"]);
    await runGit(dir, ["commit", "-m", "tip"]);
    await squashCommits(dir, [right, left], "squashed");
    assert.equal((await runGit(dir, ["log", "-1", "--format=%s"])).stdout.trim(), "tip");
    assert.equal((await runGit(dir, ["log", "-1", "--skip", "1", "--format=%s"])).stdout.trim(), "squashed");
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "two\n");
    assert.equal(await readFile(path.join(dir, "b.txt"), "utf8"), "bee\n");
    assert.equal(await readFile(path.join(dir, "c.txt"), "utf8"), "see\n");
    assert.equal(Number((await runGit(dir, ["rev-list", "--count", "HEAD"])).stdout.trim()), 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rebases onto a branch name and rejects a flag", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-rebase-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await configure(dir);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "base"]);
    await runGit(dir, ["switch", "-c", "feature"]);
    await writeFile(path.join(dir, "b.txt"), "bee\n");
    await runGit(dir, ["add", "b.txt"]);
    await runGit(dir, ["commit", "-m", "side"]);
    await runGit(dir, ["switch", "main"]);
    await writeFile(path.join(dir, "c.txt"), "see\n");
    await runGit(dir, ["add", "c.txt"]);
    await runGit(dir, ["commit", "-m", "main"]);
    await runGit(dir, ["switch", "feature"]);
    await rebaseOnto(dir, "main");
    assert.equal(await readFile(path.join(dir, "c.txt"), "utf8"), "see\n");
    assert.equal(await readFile(path.join(dir, "b.txt"), "utf8"), "bee\n");
    await assert.rejects(() => rebaseOnto(dir, "--exec"), /Unsupported revision/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
