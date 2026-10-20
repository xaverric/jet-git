import assert from "node:assert/strict";
import test from "node:test";
import { layoutGraph } from "../src/layout.js";

test("linear history stays on one lane and stops at the loaded root", () => {
  const rows = layoutGraph([
    { hash: "c", parents: ["b"] },
    { hash: "b", parents: ["a"] },
    { hash: "a", parents: [] },
  ]);
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0]);
  assert.equal(rows[0].lines.filter((line) => line.type === "down").length, 1);
  assert.equal(rows[2].lines.filter((line) => line.type === "down").length, 0);
});

test("a parent outside the loaded window does not leave a dangling line", () => {
  const rows = layoutGraph([{ hash: "b", parents: ["a"] }]);
  assert.deepEqual(rows[0].lines, []);
});

test("diverged commits join back onto the common parent", () => {
  const rows = layoutGraph([
    { hash: "d", parents: ["b"] },
    { hash: "c", parents: ["b"] },
    { hash: "b", parents: ["a"] },
    { hash: "a", parents: [] },
  ]);
  assert.equal(rows[0].lane, 0);
  assert.equal(rows[1].lane, 1);
  assert.equal(rows[2].lane, 0);
  const join = rows[2].lines.find((line) => line.type === "into");
  assert.ok(join);
  assert.equal(join.fromLane, 1);
});

test("a merge commit draws a line to each parent", () => {
  const rows = layoutGraph([
    { hash: "m", parents: ["c", "d"] },
    { hash: "c", parents: ["b"] },
    { hash: "d", parents: ["b"] },
    { hash: "b", parents: ["a"] },
    { hash: "a", parents: [] },
  ]);
  const downs = rows[0].lines.filter((line) => line.type === "down");
  assert.equal(rows[0].lane, 0);
  assert.equal(downs.length, 2);
  assert.deepEqual(downs.map((line) => line.toLane).sort(), [0, 1]);
});
