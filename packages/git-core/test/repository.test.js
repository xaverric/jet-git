import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { loadCommitDetail, loadFileDiff, loadRepositoryView } from "../src/repository.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args, dates) {
  return execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: dates,
      GIT_COMMITTER_DATE: dates,
    },
  });
}

async function initRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-"));
  await runGit(dir, ["init", "-b", "main"]);
  return dir;
}

test("loads a repository newest first and reads the commit detail", async () => {
  const dir = await initRepo();
  try {
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "first"], "2026-01-01T10:00:00");
    await writeFile(path.join(dir, "a.txt"), "two\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "second\n\nMore detail"], "2026-01-02T10:00:00");
    const view = await loadRepositoryView(dir);
    assert.equal(view.head.name, "main");
    assert.equal(view.rows[0].subject, "second");
    assert.equal(view.rows[1].subject, "first");
    assert.equal(view.rows[0].lane, 0);
    const detail = await loadCommitDetail(view.root, view.rows[0].hash);
    assert.equal(detail.body, "More detail");
    assert.deepEqual(detail.files, [{ status: "M", path: "a.txt" }]);
    const diff = await loadFileDiff(view.root, view.rows[0].hash, "a.txt");
    assert.match(diff.text, /^\+two/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("search matches a commit subject", async () => {
  const dir = await initRepo();
  try {
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "alpha unique"], "2026-01-01T10:00:00");
    await writeFile(path.join(dir, "a.txt"), "two\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "beta"], "2026-01-02T10:00:00");
    const view = await loadRepositoryView(dir, { search: "alpha unique" });
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0].subject, "alpha unique");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a path that is not a repository", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-empty-"));
  try {
    await assert.rejects(loadRepositoryView(dir), /Not a git repository/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
