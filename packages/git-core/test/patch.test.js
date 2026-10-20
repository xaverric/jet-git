import assert from "node:assert/strict";
import test from "node:test";
import { parseUnifiedDiff, splitDiffFiles } from "../src/patch.js";

test("pairs removed and added lines into a two-sided change", () => {
  const parsed = parseUnifiedDiff([
    "diff --git a/a.txt b/a.txt",
    "index 111..222 100644",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,3 @@",
    " keep",
    "-old",
    "+new",
    " tail",
  ].join("\n"));
  assert.equal(parsed.binary, false);
  assert.deepEqual(parsed.rows.map((row) => row.kind), ["hunk", "context", "change", "context"]);
  assert.deepEqual(parsed.rows[2], { kind: "change", left: 2, right: 2, before: "old", after: "new" });
});

test("keeps a pure addition on the right side only", () => {
  const parsed = parseUnifiedDiff("@@ -1 +1,2 @@\n keep\n+added\n");
  assert.equal(parsed.rows.filter((row) => row.kind === "add").length, 1);
  assert.equal(parsed.rows.find((row) => row.kind === "add").text, "added");
});

test("splits a multi-file diff by path", () => {
  const diffs = splitDiffFiles([
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-one",
    "+two",
    "diff --git a/b.txt b/b.txt",
    "--- /dev/null",
    "+++ b/b.txt",
    "@@ -0,0 +1 @@",
    "+b",
  ].join("\n"));
  assert.equal(diffs["a.txt"].rows.some((row) => row.kind === "change" && row.before === "one" && row.after === "two"), true);
  assert.equal(diffs["b.txt"].single, true);
});
