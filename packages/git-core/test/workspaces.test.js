import assert from "node:assert/strict";
import test from "node:test";
import { collapseSiblingProjects } from "../src/workspaces.js";

test("collapses sibling repositories into the parent folder", () => {
  const projects = [
    { id: "local:/work/SMARTA/one", host: "local", path: "/work/SMARTA/one", name: "one" },
    { id: "local:/work/SMARTA/two", host: "local", path: "/work/SMARTA/two", name: "two" },
    { id: "local:/work/notes", host: "local", path: "/work/notes", name: "notes" },
  ];
  const collapsed = collapseSiblingProjects(projects, "local:/work/SMARTA/two");
  assert.deepEqual(collapsed.projects.map((item) => item.path), ["/work/notes", "/work/SMARTA"]);
  assert.equal(collapsed.active, "local:/work/SMARTA");
  const again = collapseSiblingProjects(collapsed.projects, collapsed.active);
  assert.deepEqual(again.projects.map((item) => item.id), collapsed.projects.map((item) => item.id));
});

test("drops a repository that already sits inside an opened workspace", () => {
  const projects = [
    { id: "local:/work/SMARTA", host: "local", path: "/work/SMARTA", name: "SMARTA" },
    { id: "local:/work/SMARTA/one", host: "local", path: "/work/SMARTA/one", name: "one" },
  ];
  const collapsed = collapseSiblingProjects(projects, "local:/work/SMARTA/one");
  assert.deepEqual(collapsed.projects.map((item) => item.name), ["SMARTA"]);
  assert.equal(collapsed.active, "local:/work/SMARTA");
});
