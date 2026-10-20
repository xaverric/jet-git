import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { discoverProjects } from "../src/browse.js";
import { dropCommits, resetTo } from "../src/actions.js";
import { loadRepositoryView, loadWorkspaceView } from "../src/repository.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args, author = "Ada", dates) {
  return execFileAsync("git", [
    "-c", `user.name=${author}`,
    "-c", `user.email=${author.toLowerCase()}@example.com`,
    "-c", "commit.gpgsign=false",
    ...args,
  ], {
    cwd,
    env: dates ? { ...process.env, GIT_AUTHOR_DATE: dates, GIT_COMMITTER_DATE: dates } : process.env,
  });
}

test("mixes repositories by date and filters by author", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "jet-git-workspace-"));
  try {
    const older = path.join(parent, "group", "older");
    const newer = path.join(parent, "newer");
    await mkdir(older, { recursive: true });
    await mkdir(newer);
    await runGit(older, ["init", "-b", "main"]);
    await runGit(newer, ["init", "-b", "main"]);
    await writeFile(path.join(older, "a.txt"), "old\n");
    await runGit(older, ["add", "a.txt"]);
    await runGit(older, ["commit", "-m", "from ada"], "Ada", "2026-01-01T10:00:00");
    await writeFile(path.join(newer, "b.txt"), "new\n");
    await runGit(newer, ["add", "b.txt"]);
    await runGit(newer, ["commit", "-m", "from ben"], "Ben", "2026-03-01T10:00:00");
    const found = await discoverProjects(parent);
    assert.deepEqual(found.map((item) => path.basename(item)), ["newer", "older"]);
    const mixed = await loadWorkspaceView(found, { limit: 20 });
    assert.deepEqual(mixed.rows.map((row) => row.repo), ["newer", "older"]);
    assert.equal(mixed.repos.length, 2);
    const onlyAda = await loadRepositoryView(older, { author: "Ada" });
    assert.equal(onlyAda.rows.length, 1);
    assert.equal(onlyAda.rows[0].subject, "from ada");
    const dated = await loadRepositoryView(newer, { since: "01.02.2026", until: "01.04.2026" });
    assert.equal(dated.rows.length, 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("resets and drops the newest commit back into the worktree", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-reset-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "first"]);
    const first = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(dir, "a.txt"), "two\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "second"]);
    const second = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await resetTo(dir, first, "soft");
    assert.equal((await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim(), first);
    await runGit(dir, ["commit", "-m", "second again"]);
    const again = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await dropCommits(dir, [again]);
    assert.equal((await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim(), first);
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "two\n");
    void second;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
