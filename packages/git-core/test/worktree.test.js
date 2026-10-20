import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import {
  commitChanges,
  createBranch,
  loadChanges,
  loadWorkingDiff,
  parseStatus,
  pullHead,
  pushHead,
  setStaged,
} from "../src/worktree.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args) {
  return execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
}

async function configure(dir) {
  await runGit(dir, ["config", "user.name", "Test"]);
  await runGit(dir, ["config", "user.email", "test@example.com"]);
  await runGit(dir, ["config", "commit.gpgsign", "false"]);
}

test("parses branch tracking, renames and local changes", () => {
  const parsed = parseStatus("## main...origin/main [ahead 1, behind 2]\0R  b.txt\0a.txt\0?? new.txt\0");
  assert.equal(parsed.branch, "main");
  assert.equal(parsed.upstream, "origin/main");
  assert.equal(parsed.ahead, 1);
  assert.equal(parsed.behind, 2);
  assert.deepEqual(parsed.files.map((file) => [file.path, file.status, file.staged, file.untracked]), [
    ["b.txt", "R", true, false],
    ["new.txt", "?", false, true],
  ]);
});

test("shows a working diff, commits it, pushes and opens a branch", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "jet-git-work-"));
  const dir = path.join(parent, "repo");
  const bare = path.join(parent, "bare.git");
  const other = path.join(parent, "other");
  try {
    await runGit(parent, ["init", "-b", "main", dir]);
    await configure(dir);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "first"]);
    await runGit(parent, ["init", "--bare", bare]);
    await runGit(dir, ["remote", "add", "origin", bare]);

    await writeFile(path.join(dir, "a.txt"), "two\n");
    await writeFile(path.join(dir, "new.txt"), "fresh\n");
    const dirty = await loadChanges(dir);
    assert.deepEqual(dirty.files.map((file) => file.path), ["a.txt", "new.txt"]);
    const diff = await loadWorkingDiff(dir, "a.txt");
    assert.equal(diff.rows.some((row) => row.kind === "change" && row.before === "one" && row.after === "two"), true);
    const added = await loadWorkingDiff(dir, "new.txt");
    assert.equal(added.rows.some((row) => row.kind === "add" && row.text === "fresh"), true);

    await assert.rejects(() => commitChanges(dir, { message: "  " }), (error) => error.code === "EMPTY_MESSAGE");
    await setStaged(dir, "a.txt", true);
    await setStaged(dir, "new.txt", true);
    const committed = await commitChanges(dir, { message: "second" });
    assert.equal((await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim(), committed.hash);
    assert.equal((await runGit(dir, ["log", "-1", "--format=%s"])).stdout.trim(), "second");

    const pushed = await pushHead(dir);
    assert.equal(pushed.upstream, "origin/main");
    assert.equal(pushed.ahead, 0);

    await runGit(parent, ["clone", bare, other]);
    await configure(other);
    await writeFile(path.join(other, "a.txt"), "three\n");
    await runGit(other, ["add", "a.txt"]);
    await runGit(other, ["commit", "-m", "remote"]);
    await runGit(other, ["push"]);
    const pulled = await pullHead(dir);
    assert.equal(pulled.behind, 0);
    assert.equal((await runGit(dir, ["log", "-1", "--format=%s"])).stdout.trim(), "remote");

    await createBranch(dir, "feature");
    assert.equal((await runGit(dir, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(), "feature");
    await assert.rejects(() => createBranch(dir, "bad name"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
