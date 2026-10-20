import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { GitCoreError } from "./errors.js";
import { git, parseLocation, remoteCommand } from "./git.js";
import { parseUnifiedDiff } from "./patch.js";
import { resolveRoot } from "./repository.js";

function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function assertStash(id) {
  if (typeof id !== "string" || !/^stash@\{\d{1,4}\}$/.test(id)) {
    throw new GitCoreError("Unsupported stash.", { code: "BAD_REVISION" });
  }
  return id;
}

function assertShelfName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 120) {
    throw new GitCoreError("Unsupported shelf.", { code: "BAD_PATH" });
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === ".." || name.startsWith(".")) {
    throw new GitCoreError("Unsupported shelf.", { code: "BAD_PATH" });
  }
  return name;
}

export function ideaPatchToUnified(text) {
  const out = [];
  let extra = false;
  for (const line of String(text ?? "").split("\n")) {
    if (line === "IDEA additional info:" || line.startsWith("Subsystem:") || line.startsWith("<+>") || line.startsWith("<=>")) {
      extra = true;
      continue;
    }
    if (line.startsWith("====")) continue;
    if (extra) {
      const patchLine = line.startsWith("diff --git ")
        || line.startsWith("--- ")
        || line.startsWith("+++ ")
        || line.startsWith("Index: ")
        || line.startsWith("@@");
      if (!patchLine) continue;
      extra = false;
    }
    out.push(line);
  }
  const body = out.join("\n");
  return body.endsWith("\n") || body.length === 0 ? body : `${body}\n`;
}

export function filesInUnified(text) {
  const files = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) continue;
    files.push(match[2] === "/dev/null" ? match[1] : match[2]);
  }
  if (files.length > 0) return [...new Set(files)];
  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("+++ b/")) files.push(line.slice("+++ b/".length).split("\t")[0]);
    else if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) files.push(line.slice(4).split("\t")[0]);
  }
  return [...new Set(files.filter(Boolean))];
}

export function sliceUnifiedFile(text, file) {
  const source = String(text ?? "");
  if (!file) return source;
  const parts = source.split(/^(?=diff --git )/m).filter(Boolean);
  const match = parts.find((part) => part.startsWith(`diff --git a/${file} b/${file}\n`) || part.startsWith(`diff --git a/${file} b/${file}\r`));
  return match || source;
}

function present(text) {
  const limit = 200_000;
  const truncated = text.length > limit;
  const source = truncated ? text.slice(0, limit) : text;
  return { ...parseUnifiedDiff(source), truncated, text: source };
}

async function listStashes(root) {
  const text = await git(root, ["stash", "list", "--format=%gd%x1f%H%x1f%gs"]);
  const stashes = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [id, hash, subject] = line.split("\x1f");
    if (!/^stash@\{\d{1,4}\}$/.test(id || "")) continue;
    stashes.push({ id, hash: hash || "", subject: subject || id });
  }
  return stashes;
}

async function listLocalShelves(root) {
  const shelf = path.join(parseLocation(root).path, ".idea", "shelf");
  let entries = [];
  try {
    entries = await readdir(shelf, { withFileTypes: true });
  } catch {
    return [];
  }
  const shelves = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const info = await stat(path.join(shelf, entry.name, "shelved.patch"));
      shelves.push({ name: entry.name, modifiedAt: info.mtime.toISOString() });
    } catch {
      continue;
    }
  }
  return shelves.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

async function listRemoteShelves(location) {
  const shelf = `${location.path}/.idea/shelf`;
  const listed = await remoteCommand(location.host, `find ${quote(shelf)} -mindepth 2 -maxdepth 2 -name shelved.patch -print 2>/dev/null || true`);
  const shelves = [];
  for (const line of String(listed).split("\n")) {
    const patch = line.trim();
    if (!patch.endsWith("/shelved.patch")) continue;
    const name = patch.slice(0, -"/shelved.patch".length).split("/").pop();
    if (!name || name.startsWith(".")) continue;
    shelves.push({ name, modifiedAt: "" });
  }
  return shelves.sort((left, right) => left.name.localeCompare(right.name));
}

async function readShelfPatch(root, name) {
  assertShelfName(name);
  const location = parseLocation(root);
  if (location.host) {
    const file = `${location.path}/.idea/shelf/${name}/shelved.patch`;
    return remoteCommand(location.host, `cat ${quote(file)}`);
  }
  return readFile(path.join(location.path, ".idea", "shelf", name, "shelved.patch"), "utf8");
}

async function removeShelf(root, name) {
  assertShelfName(name);
  const location = parseLocation(root);
  const dir = location.host
    ? `${location.path}/.idea/shelf/${name}`
    : path.join(location.path, ".idea", "shelf", name);
  if (location.host) {
    await remoteCommand(location.host, `test -f ${quote(`${dir}/shelved.patch`)} && rm -rf ${quote(dir)}`);
    return;
  }
  const patch = path.join(dir, "shelved.patch");
  await stat(patch);
  await rm(dir, { recursive: true });
}

export async function listSaved(root) {
  const resolved = await resolveRoot(root);
  const location = parseLocation(resolved);
  const [stashes, shelves] = await Promise.all([
    listStashes(resolved),
    location.host ? listRemoteShelves(location) : listLocalShelves(resolved),
  ]);
  return { stashes, shelves };
}

export async function savedPatch(root, kind, id, file) {
  const resolved = await resolveRoot(root);
  let raw = "";
  if (kind === "stash") {
    raw = await git(resolved, ["stash", "show", "-p", "--format=", assertStash(id)]);
  } else if (kind === "shelf") {
    raw = ideaPatchToUnified(await readShelfPatch(resolved, id));
  } else {
    throw new GitCoreError("Unknown patch.", { code: "GIT_ERROR" });
  }
  const files = filesInUnified(raw).map((item) => ({ path: item, status: "M" }));
  const chosen = typeof file === "string" && file ? file : (files[0]?.path || "");
  if (chosen && !files.some((item) => item.path === chosen) && files.length > 0) {
    throw new GitCoreError("File is not part of this patch.", { code: "BAD_PATH" });
  }
  const sliced = files.length > 0 ? sliceUnifiedFile(raw, chosen) : raw;
  return { files, path: chosen, ...present(sliced) };
}

export async function dropSaved(root, kind, id) {
  const resolved = await resolveRoot(root);
  if (kind === "stash") {
    await git(resolved, ["stash", "drop", assertStash(id)]);
    return { dropped: true };
  }
  if (kind !== "shelf") throw new GitCoreError("Unknown patch.", { code: "GIT_ERROR" });
  await removeShelf(resolved, id);
  return { dropped: true };
}

export async function applySaved(root, kind, id, remove = false) {
  const resolved = await resolveRoot(root);
  if (kind === "stash") {
    const stash = assertStash(id);
    await git(resolved, remove ? ["stash", "pop", stash] : ["stash", "apply", stash]);
    return { applied: true, removed: remove === true };
  }
  if (kind !== "shelf") throw new GitCoreError("Unknown patch.", { code: "GIT_ERROR" });
  const patch = ideaPatchToUnified(await readShelfPatch(resolved, id));
  if (!patch.includes("diff --git ") && !patch.includes("\n@@")) {
    throw new GitCoreError("Shelf patch has nothing to apply.", { code: "BAD_PATH" });
  }
  await git(resolved, ["apply", "--3way", "--whitespace=nowarn"], { input: patch });
  if (remove) await removeShelf(resolved, id);
  return { applied: true, removed: remove === true };
}
