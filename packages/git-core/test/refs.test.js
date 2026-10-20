import assert from "node:assert/strict";
import test from "node:test";
import { parseDecorations, parseLog, parseNameStatus } from "../src/parse.js";
import { buildBranchPanel, parseRefRecords } from "../src/refs.js";

test("parses log records and decorations", () => {
  const text = [
    ["abc", "def", "Ada", "ada@example.com", "2026-10-03T10:46:00+02:00", "HEAD -> main, origin/main, tag: v1", "Subject", "Body line"].join("\x1f"),
    "",
  ].join("\0");
  const [commit] = parseLog(text);
  assert.equal(commit.hash, "abc");
  assert.deepEqual(commit.parents, ["def"]);
  assert.equal(commit.subject, "Subject");
  assert.equal(commit.body, "Body line");
  assert.deepEqual(parseDecorations(commit.decorations.length ? "HEAD -> main, origin/main, tag: v1" : ""), commit.decorations);
  assert.equal(commit.decorations[0].head, true);
  assert.equal(commit.decorations[0].name, "main");
  assert.equal(commit.decorations[2].tag, true);
  assert.equal(commit.decorations[2].name, "v1");
});

test("parses name-status pairs", () => {
  assert.deepEqual(parseNameStatus("M\0src/app.js\0A\0src/new.js\0"), [
    { status: "M", path: "src/app.js" },
    { status: "A", path: "src/new.js" },
  ]);
});

test("groups local, remote and tag refs into a branch tree", () => {
  const records = parseRefRecords([
    "aaa\trefs/heads/main\t1",
    "bbb\trefs/heads/feature/one\t0",
    "aaa\trefs/remotes/origin/HEAD\t0",
    "aaa\trefs/remotes/origin/main\t0",
    "ccc\trefs/remotes/origin/feature/one\t0",
    "aaa\trefs/tags/v1\t0",
  ].join("\n") + "\n");
  const panel = buildBranchPanel(records, { name: "main", hash: "aaa", detached: false });
  assert.equal(panel.head.label, "main");
  assert.equal(panel.head.ref, "refs/heads/main");
  assert.equal(panel.local[0].label, "feature");
  assert.equal(panel.local[0].children[0].ref, "refs/heads/feature/one");
  assert.equal(panel.local[1].label, "main");
  assert.equal(panel.local[1].current, true);
  assert.equal(panel.remotes[0].name, "origin");
  assert.equal(panel.remotes[0].children.some((node) => node.label === "HEAD"), false);
  assert.equal(panel.tags[0].ref, "refs/tags/v1");
  assert.equal(panel.tags[0].hash, "aaa");
});

test("annotated tags point at the commit and newer tags come first", () => {
  const records = parseRefRecords([
    "tagold\tcommitold\t10\trefs/tags/v1\t0",
    "tagnew\tcommitnew\t20\trefs/tags/v2\t0",
  ].join("\n"));
  const panel = buildBranchPanel(records, { name: "main", hash: "commitnew", detached: false });
  assert.deepEqual(panel.tags.map((tag) => [tag.label, tag.hash]), [
    ["v2", "commitnew"],
    ["v1", "commitold"],
  ]);
});
