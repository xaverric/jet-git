import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { GitCoreError } from "./errors.js";
import { formatLocation, git, parseLocation, remoteCommand } from "./git.js";
import { parseNameStatus } from "./parse.js";
import { parseUnifiedDiff, splitDiffFiles } from "./patch.js";
import { resolveRoot } from "./repository.js";

function assertHash(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{7,40}$/i.test(value)) {
    throw new GitCoreError("Unsupported commit.", { code: "BAD_REVISION" });
  }
  return value;
}

function assertRef(value) {
  const name = String(value ?? "").trim();
  if (!name || name.startsWith("-") || name.includes("..") || /[\0\n\r^~:?*[\\\s]/.test(name)) {
    throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
  }
  return name;
}

function assertListedFile(file, files) {
  if (typeof file !== "string" || file.length === 0 || file.includes("\0") || file.split("/").includes("..")) {
    throw new GitCoreError("Unsupported path.", { code: "BAD_PATH" });
  }
  if (!files.some((item) => item.path === file)) {
    throw new GitCoreError("File is not part of this change.", { code: "BAD_PATH" });
  }
}

async function tryRoot(directory) {
  try {
    return await resolveRoot(directory);
  } catch (error) {
    if (error instanceof GitCoreError && error.code === "NOT_A_REPOSITORY") return null;
    throw error;
  }
}

async function walkLocal(directory, depth, found) {
  if (depth > 4 || found.length >= 400) return;
  let gitEntry = false;
  try {
    await stat(path.join(directory, ".git"));
    gitEntry = true;
  } catch {
    gitEntry = false;
  }
  if (gitEntry) {
    const root = await tryRoot(directory);
    if (root && !found.includes(root)) found.push(root);
    return;
  }
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    if (depth === 0) throw new GitCoreError("Not a git repository.", { code: "NOT_A_REPOSITORY" });
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    await walkLocal(path.join(directory, entry.name), depth + 1, found);
  }
}

function hiddenParent(gitDir) {
  const parts = gitDir.split("/");
  parts.pop();
  return parts.some((part) => part.startsWith(".") || part === "node_modules");
}

async function discoverRemote(location) {
  const quoted = `'${location.path.replaceAll("'", `'\\''`)}'`;
  const listed = await remoteCommand(location.host, `find ${quoted} -maxdepth 4 -name .git -print`);
  const found = [];
  for (const line of String(listed).split("\n")) {
    const gitDir = line.trim();
    if (!gitDir || hiddenParent(gitDir)) continue;
    const root = formatLocation(location.host, path.posix.dirname(gitDir));
    if (!found.includes(root)) found.push(root);
    if (found.length >= 400) break;
  }
  if (found.length === 0) throw new GitCoreError("Not a git repository.", { code: "NOT_A_REPOSITORY" });
  return found.sort((left, right) => path.posix.basename(parseLocation(left).path).localeCompare(path.posix.basename(parseLocation(right).path)));
}

export async function discoverProjects(directory) {
  const location = parseLocation(directory);
  if (location.host) return discoverRemote(location);
  const found = [];
  await walkLocal(directory, 0, found);
  if (found.length === 0) throw new GitCoreError("Not a git repository.", { code: "NOT_A_REPOSITORY" });
  return found.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

export async function checkoutRevision(root, rev) {
  const resolvedRoot = await resolveRoot(root);
  const target = assertRef(rev);
  if (target.startsWith("refs/heads/")) {
    await git(resolvedRoot, ["switch", target.slice("refs/heads/".length)]);
    return { root: resolvedRoot };
  }
  if (target.startsWith("refs/")) {
    await git(resolvedRoot, ["switch", "--detach", target]);
    return { root: resolvedRoot };
  }
  let local = false;
  try {
    await git(resolvedRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${target}`]);
    local = true;
  } catch (error) {
    if (error.code !== "GIT_ERROR") throw error;
  }
  if (local) await git(resolvedRoot, ["switch", target]);
  else await git(resolvedRoot, ["switch", "--detach", target]);
  return { root: resolvedRoot };
}

export async function compareRevisions(root, from, to) {
  const resolvedRoot = await resolveRoot(root);
  const hashOf = async (value) => {
    const rev = String(value ?? "");
    const allowed = rev === "HEAD" || rev.startsWith("refs/") || /^[0-9a-f]{7,40}$/i.test(rev);
    if (!allowed || rev.startsWith("-") || rev.includes("..")) {
      throw new GitCoreError("Unsupported revision.", { code: "BAD_REVISION" });
    }
    return (await git(resolvedRoot, ["rev-parse", "--verify", `${rev}^{commit}`])).trim();
  };
  return compareCommits(resolvedRoot, await hashOf(from), await hashOf(to));
}

export async function compareCommits(root, from, to) {
  const resolvedRoot = await resolveRoot(root);
  const left = assertHash(from);
  const right = assertHash(to);
  const [status, text] = await Promise.all([
    git(resolvedRoot, ["diff", "--name-status", "--no-renames", "-z", left, right]),
    git(resolvedRoot, ["diff", "--no-color", "--no-renames", left, right]),
  ]);
  const files = parseNameStatus(status);
  const diffs = text.length > 4_000_000 ? {} : splitDiffFiles(text);
  for (const file of files) {
    if (diffs[file.path]) diffs[file.path] = { path: file.path, ...diffs[file.path] };
  }
  return { root: resolvedRoot, from: left, to: right, files, diffs };
}

function presentDiff(text) {
  const limit = 200_000;
  const truncated = text.length > limit;
  const source = truncated ? text.slice(0, limit) : text;
  const parsed = parseUnifiedDiff(source);
  return { ...parsed, truncated, text: source };
}

export async function compareFile(root, from, to, file) {
  const compared = await compareCommits(root, from, to);
  assertListedFile(file, compared.files);
  const text = await git(compared.root, ["diff", "--no-color", compared.from, compared.to, "--", file]);
  return { path: file, ...presentDiff(text) };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function safeRelative(prefix) {
  const clean = String(prefix ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (clean.includes("\0") || clean.split("/").includes("..")) {
    throw new GitCoreError("Unsupported path.", { code: "BAD_PATH" });
  }
  return clean;
}

export async function listPaths(root, prefix = "") {
  const clean = safeRelative(prefix);
  const slash = clean.lastIndexOf("/");
  const dir = slash >= 0 ? clean.slice(0, slash) : "";
  const rest = (slash >= 0 ? clean.slice(slash + 1) : clean).toLowerCase();
  let stdout = "";
  try {
    stdout = await git(root, ["ls-tree", "-z", dir ? `HEAD:${dir}` : "HEAD"]);
  } catch (error) {
    if (error instanceof GitCoreError) return [];
    throw error;
  }
  const items = [];
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const name = record.slice(tab + 1);
    if (!name || name.split("/").includes("..")) continue;
    if (rest && !name.toLowerCase().startsWith(rest)) continue;
    const directory = record.startsWith("040000");
    const full = dir ? `${dir}/${name}` : name;
    items.push({ path: directory ? `${full}/` : full, name, directory });
  }
  items.sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name));
  return items.slice(0, 80);
}

function assertAbsolute(dir) {
  if (typeof dir !== "string" || !dir.startsWith("/") || dir.split("/").includes("..")) {
    throw new GitCoreError("Folder must be absolute.", { code: "BAD_PATH" });
  }
  return dir;
}

async function localEntries(dir) {
  const names = await readdir(dir, { withFileTypes: true });
  const entries = [];
  for (const item of names) {
    if (!item.isDirectory() || item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    let gitRepo = false;
    try {
      const marker = await stat(path.join(full, ".git"));
      gitRepo = marker.isDirectory() || marker.isFile();
    } catch {
      gitRepo = false;
    }
    entries.push({ name: item.name, path: full, git: gitRepo });
  }
  entries.sort((left, right) => Number(right.git) - Number(left.git) || left.name.localeCompare(right.name));
  return entries;
}

async function remoteEntries(host, dir) {
  const script = `cd ${shellQuote(dir)}; find . -mindepth 1 -maxdepth 1 -type d ! -name '.*' | while IFS= read -r item; do name=\${item#./}; if [ -e "$item/.git" ]; then printf 'git %s\\n' "$name"; else printf 'dir %s\\n' "$name"; fi; done`;
  const stdout = await remoteCommand(host, script);
  const entries = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const gitRepo = line.startsWith("git ");
    const name = line.slice(4);
    if (!name || name.includes("/") || name.startsWith(".")) continue;
    entries.push({ name, path: path.posix.join(dir, name), git: gitRepo });
  }
  entries.sort((left, right) => Number(right.git) - Number(left.git) || left.name.localeCompare(right.name));
  return entries;
}

export async function browseDirectory(location) {
  let host = null;
  let dir = location;
  if (typeof location === "string" && location.startsWith("ssh://")) {
    const parsed = parseLocation(location);
    host = parsed.host;
    dir = parsed.path;
  }
  if (host && (!dir || dir === "/")) {
    const home = (await remoteCommand(host, 'printf %s "$HOME"')).trim();
    dir = home;
  }
  dir = assertAbsolute(dir);
  const entries = host ? await remoteEntries(host, dir) : await localEntries(dir);
  const parent = dir === "/" ? null : path.posix.dirname(dir);
  return { path: dir, parent, entries };
}
