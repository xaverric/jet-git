import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { commitReview, loadReview, revisionBranch } from "../src/review.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args) {
  return execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
}

test("commits a review onto revision/<branch> without leaving the reviewed branch", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-review-"));
  try {
    await runGit(dir, ["init", "-b", "feature/dj_test"]);
    await runGit(dir, ["config", "user.name", "Test"]);
    await runGit(dir, ["config", "user.email", "test@example.com"]);
    await runGit(dir, ["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "first"]);
    const head = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    const comment = {
      id: "comment-1",
      path: "a.txt",
      side: "new",
      start: 1,
      end: 1,
      body: "Check this line.",
      createdAt: "2026-10-19T10:00:00.000Z",
    };
    const saved = await commitReview(dir, { head, comments: [comment] });
    assert.equal(saved.revisionBranch, "revision/feature/dj_test");
    assert.equal(revisionBranch("feature/dj_test"), saved.revisionBranch);
    assert.equal((await runGit(dir, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(), "feature/dj_test");
    assert.equal((await runGit(dir, ["status", "--porcelain"])).stdout, "");
    const loaded = await loadReview(dir);
    assert.equal(loaded.format, "jet-git-review");
    assert.equal(loaded.version, 1);
    assert.equal(loaded.branch, "feature/dj_test");
    assert.equal(loaded.head, head);
    assert.deepEqual(loaded.comments, [comment]);
    const tree = (await runGit(dir, ["rev-parse", `${saved.commit}^{tree}`])).stdout.trim();
    const base = (await runGit(dir, ["rev-parse", `${head}^{tree}`])).stdout.trim();
    const reviewed = (await runGit(dir, ["ls-tree", "-r", "--name-only", tree])).stdout.trim().split("\n").sort();
    const original = (await runGit(dir, ["ls-tree", "-r", "--name-only", base])).stdout.trim().split("\n");
    assert.deepEqual(reviewed, [...original, ".jet-git/review.json"].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
