import assert from "node:assert/strict";
import test from "node:test";
import { parseGitBatch, remoteGitCommand } from "../src/git.js";

test("remote git leaves environment assignments unquoted", () => {
  const command = remoteGitCommand("/repo", ["rev-parse", "HEAD"]);
  assert.equal(command, "GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never 'git' '-C' '/repo' 'rev-parse' 'HEAD'");
});

test("splits a remote git batch into stdout, stderr and codes", () => {
  const marker = "@@JET@@";
  const stdout = [
    `${marker}OUT0`,
    "main",
    `${marker}ERR0`,
    `${marker}CODE0`,
    "0",
    `${marker}OUT1`,
    `${marker}ERR1`,
    "fatal: not a branch",
    `${marker}CODE1`,
    "128",
    "",
  ].join("\n");
  const parsed = parseGitBatch(stdout, marker, 2);
  assert.equal(parsed[0].stdout, "main\n");
  assert.equal(parsed[0].code, 0);
  assert.equal(parsed[1].stderr, "fatal: not a branch\n");
  assert.equal(parsed[1].code, 128);
});
