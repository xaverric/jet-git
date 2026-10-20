import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { applySaved, filesInUnified, ideaPatchToUnified, listSaved, savedPatch } from "../src/shelf.js";

const execFileAsync = promisify(execFile);

function runGit(cwd, args) {
  return execFileAsync("git", ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
}

test("strips JetBrains patch headers and applies a shelf", async () => {
  const raw = [
    "Index: src/App.txt",
    "IDEA additional info:",
    "Subsystem: com.intellij.openapi.diff.impl.patch.CharsetEP",
    "<+>UTF-8",
    "===================================================================",
    "diff --git a/src/App.txt b/src/App.txt",
    "--- a/src/App.txt",
    "+++ b/src/App.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const unified = ideaPatchToUnified(raw);
  assert.equal(unified.includes("IDEA additional info:"), false);
  assert.equal(unified.includes("Subsystem:"), false);
  assert.deepEqual(filesInUnified(unified), ["src/App.txt"]);
  const root = await mkdtemp(path.join(tmpdir(), "jet-git-shelf-"));
  try {
    await runGit(root, ["init", "-b", "main"]);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "App.txt"), "old\n");
    await runGit(root, ["add", "src/App.txt"]);
    await runGit(root, ["commit", "-m", "base"]);
    const shelf = path.join(root, ".idea", "shelf", "Unnamed");
    await mkdir(shelf, { recursive: true });
    await writeFile(path.join(shelf, "shelved.patch"), raw);
    const listed = await listSaved(root);
    assert.deepEqual(listed.shelves.map((item) => item.name), ["Unnamed"]);
    const patch = await savedPatch(root, "shelf", "Unnamed");
    assert.equal(patch.path, "src/App.txt");
    assert.equal(patch.rows.some((row) => row.kind === "change" || row.kind === "add"), true);
    await applySaved(root, "shelf", "Unnamed", true);
    assert.equal(await readFile(path.join(root, "src", "App.txt"), "utf8"), "new\n");
    const after = await listSaved(root);
    assert.equal(after.shelves.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lists a stash and applies it back", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jet-git-stash-"));
  try {
    await runGit(root, ["init", "-b", "main"]);
    await writeFile(path.join(root, "a.txt"), "one\n");
    await runGit(root, ["add", "a.txt"]);
    await runGit(root, ["commit", "-m", "base"]);
    await writeFile(path.join(root, "a.txt"), "two\n");
    await runGit(root, ["stash", "push", "-m", "wip"]);
    const listed = await listSaved(root);
    assert.equal(listed.stashes.length, 1);
    assert.match(listed.stashes[0].subject, /wip/);
    const patch = await savedPatch(root, "stash", listed.stashes[0].id);
    assert.equal(patch.files[0].path, "a.txt");
    await applySaved(root, "stash", listed.stashes[0].id, false);
    assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "two\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
