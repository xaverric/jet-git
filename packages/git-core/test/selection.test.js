import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { loadSelection, loadSelectionDiff, mergeFileStatuses } from "../src/selection.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args) {
  return execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
}

test("keeps a file added inside the selection green and a later deletion grey", () => {
  const files = mergeFileStatuses([
    [{ path: "a.txt", status: "A" }, { path: "b.txt", status: "A" }],
    [{ path: "a.txt", status: "M" }, { path: "b.txt", status: "D" }, { path: "c.txt", status: "A" }],
  ]);
  assert.deepEqual(files, [
    { path: "a.txt", status: "A" },
    { path: "b.txt", status: "D" },
    { path: "c.txt", status: "A" },
  ]);
});

test("combines files from three commits and lists branches that contain the focused one", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "jet-git-select-"));
  const dir = path.join(parent, "repo");
  const bare = path.join(parent, "bare.git");
  try {
    await runGit(parent, ["init", "-b", "main", dir]);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "add a"]);
    const first = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(dir, "a.txt"), "two\n");
    await writeFile(path.join(dir, "b.txt"), "b\n");
    await runGit(dir, ["add", "a.txt", "b.txt"]);
    await runGit(dir, ["commit", "-m", "edit a add b"]);
    const second = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await runGit(dir, ["rm", "b.txt"]);
    await writeFile(path.join(dir, "c.txt"), "c\n");
    await runGit(dir, ["add", "c.txt"]);
    await runGit(dir, ["commit", "-m", "drop b add c"]);
    const third = (await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim();
    await runGit(parent, ["init", "--bare", "-b", "main", bare]);
    await runGit(dir, ["remote", "add", "origin", bare]);
    await runGit(dir, ["push", "-u", "origin", "main"]);
    await runGit(dir, ["branch", "other", first]);

    const selected = await loadSelection(dir, [third, second, first], third);
    assert.deepEqual(selected.files, [
      { path: "a.txt", status: "A" },
      { path: "b.txt", status: "D" },
      { path: "c.txt", status: "A" },
    ]);
    assert.equal(selected.commit.subject, "drop b add c");
    assert.deepEqual(selected.commit.branches, ["HEAD", "main", "origin/main"]);

    const older = await loadSelection(dir, [second], second);
    assert.equal(older.files.some((file) => file.path === "a.txt" && file.status === "M"), true);
    assert.equal(older.diffs["a.txt"].rows.some((row) => row.kind === "change" && row.before === "one" && row.after === "two"), true);
    const diff = await loadSelectionDiff(dir, [second], "a.txt");
    assert.equal(diff.rows.some((row) => row.kind === "change" && row.before === "one" && row.after === "two"), true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
