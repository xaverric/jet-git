import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { browseDirectory, checkoutRevision, compareCommits, compareFile, discoverProjects, listPaths } from "../src/browse.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args, dates) {
  return execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_DATE: dates, GIT_COMMITTER_DATE: dates },
  });
}

test("discovers sibling repositories and leaves a repository as a single project", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "jet-git-projects-"));
  try {
    const one = path.join(parent, "one");
    const two = path.join(parent, "two");
    await mkdir(one);
    await mkdir(two);
    await runGit(one, ["init", "-b", "main"]);
    await runGit(two, ["init", "-b", "main"]);
    const many = await discoverProjects(parent);
    assert.deepEqual(many.map((item) => path.basename(item)), ["one", "two"]);
    assert.deepEqual(await discoverProjects(one), [await runGit(one, ["rev-parse", "--show-toplevel"]).then((result) => result.stdout.trim())]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("checks out a branch and compares two commits", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jet-git-browse-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "first"], "2026-02-01T10:00:00");
    const first = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await runGit(dir, ["switch", "-c", "feature"]);
    await writeFile(path.join(dir, "a.txt"), "two\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "second"], "2026-02-02T10:00:00");
    const second = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await checkoutRevision(dir, "refs/heads/main");
    assert.equal((await runGit(dir, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(), "main");
    const compared = await compareCommits(dir, first, second);
    assert.deepEqual(compared.files, [{ status: "M", path: "a.txt" }]);
    const file = await compareFile(dir, first, second, "a.txt");
    assert.equal(file.rows.some((row) => row.kind === "change" && row.before === "one" && row.after === "two"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lists paths inside a repository and folders on disk", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "jet-git-paths-"));
  try {
    const repo = path.join(parent, "repo");
    const plain = path.join(parent, "plain");
    await mkdir(path.join(repo, "src"), { recursive: true });
    await mkdir(plain);
    await mkdir(path.join(parent, ".hidden"));
    await runGit(repo, ["init", "-b", "main"]);
    await writeFile(path.join(repo, "src", "App.txt"), "class App {}\n");
    await writeFile(path.join(repo, "README"), "hi\n");
    await runGit(repo, ["add", "."]);
    await runGit(repo, ["commit", "-m", "files"]);
    const top = await listPaths(repo, "");
    assert.deepEqual(top.map((item) => item.path), ["src/", "README"]);
    assert.deepEqual((await listPaths(repo, "s")).map((item) => item.path), ["src/"]);
    assert.deepEqual((await listPaths(repo, "src/")).map((item) => item.path), ["src/App.txt"]);
    const listed = await browseDirectory(parent);
    assert.equal(listed.path, parent);
    assert.deepEqual(listed.entries.map((item) => item.name), ["repo", "plain"]);
    assert.equal(listed.entries[0].git, true);
    assert.equal(listed.entries[1].git, false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
