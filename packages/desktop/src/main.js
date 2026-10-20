import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeImage, nativeTheme } from "electron";
import {
  GitCoreError,
  abortOperation,
  checkoutRevision,
  cherryPick,
  commitChanges,
  commitReview,
  compareRevisions,
  compareFile,
  continueOperation,
  createBranch,
  createPatch,
  createTag,
  deleteBranch,
  deleteTag,
  discardPath,
  browseDirectory,
  discoverProjects,
  listPaths,
  dropCommits,
  fetchRemotes,
  loadChanges,
  loadCommitDetail,
  loadFileDiff,
  loadReview,
  loadWorkspaceView,
  listSaved,
  savedPatch,
  applySaved,
  dropSaved,
  loadSelection,
  loadSelectionDiff,
  loadWorkingDiff,
  mergeRef,
  pullHead,
  pushHead,
  pushUpTo,
  rebaseOnto,
  resetTo,
  resolveSide,
  revertCommit,
  revertCommits,
  setStaged,
  squashCommits,
  stashPop,
  stashSave,
  collapseSiblingProjects,
} from "@jet-git/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appIcon = nativeImage.createFromPath(path.join(__dirname, "../assets/icon.png"));
const DEFAULT_SETTINGS = {
  appearance: {
    theme: "dark",
    translucent: false,
    fontSize: 12,
    syntax: true,
  },
};

const LOCAL_HOST = { id: "local", label: "This Mac", ssh: null };

let windowRef = null;
let session = { hosts: [LOCAL_HOST], activeHost: "local", projects: [], active: null };
let settings = structuredClone(DEFAULT_SETTINGS);

function result(data) {
  return { ok: true, data };
}

function failure(error) {
  const code = error instanceof GitCoreError ? error.code : "GIT_ERROR";
  return { ok: false, error: error instanceof Error ? error.message : "Unknown error", code };
}

function sessionFile() {
  return path.join(app.getPath("userData"), "session.json");
}

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings(parsed) {
  const appearance = { ...DEFAULT_SETTINGS.appearance, ...(parsed?.appearance ?? {}) };
  if (!["dark", "light", "system"].includes(appearance.theme)) appearance.theme = "dark";
  appearance.translucent = appearance.translucent === true;
  appearance.syntax = appearance.syntax !== false;
  const size = Number(appearance.fontSize);
  appearance.fontSize = [11, 12, 14].includes(size) ? size : 12;
  return { appearance };
}

async function loadSettings() {
  try {
    settings = readSettings(JSON.parse(await readFile(settingsFile(), "utf8")));
  } catch {
    settings = structuredClone(DEFAULT_SETTINGS);
  }
}

async function saveSettings() {
  await mkdir(path.dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(settings));
}

function applyWindowAppearance() {
  nativeTheme.themeSource = settings.appearance.theme;
  const win = windowRef;
  if (!win) return;
  const translucent = settings.appearance.translucent && process.platform === "darwin";
  if (process.platform === "darwin") {
    try {
      win.setVibrancy(translucent ? "under-window" : null);
    } catch {
      // vibrancy is unavailable on this macOS build
    }
  }
  const dark = nativeTheme.shouldUseDarkColors;
  win.setBackgroundColor(translucent ? "#00000000" : (dark ? "#2b2d30" : "#f4f5f7"));
}

function settingsPayload() {
  return { ...settings, dark: nativeTheme.shouldUseDarkColors };
}

function configuredHosts() {
  let text = "";
  try {
    text = readFileSync(path.join(os.homedir(), ".ssh", "config"), "utf8");
  } catch {
    return [];
  }
  const hosts = [];
  const seen = new Set();
  for (const line of text.split("\n")) {
    const match = /^\s*Host\s+(.+)$/i.exec(line);
    if (!match) continue;
    for (const name of match[1].split(/\s+/)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || seen.has(name)) continue;
      seen.add(name);
      hosts.push({ id: `ssh:${name}`, label: name, ssh: name });
    }
  }
  return hosts;
}

function locationOf(host, folder) {
  if (!host?.ssh) return folder;
  return `ssh://${host.ssh}${folder.startsWith("/") ? folder : `/${folder}`}`;
}

function sessionPayload() {
  return {
    active: session.active,
    activeHost: session.activeHost,
    hosts: session.hosts,
    projects: session.projects,
  };
}

async function saveSession() {
  await mkdir(path.dirname(sessionFile()), { recursive: true });
  await writeFile(sessionFile(), JSON.stringify(session));
}

function readSession(parsed) {
  const hosts = [LOCAL_HOST];
  const stored = Array.isArray(parsed.hosts) ? parsed.hosts : [];
  for (const host of [...stored, ...configuredHosts()]) {
    if (!host || host.id === "local" || hosts.some((item) => item.id === host.id)) continue;
    if (typeof host.label !== "string" || (host.ssh != null && !/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host.ssh))) continue;
    hosts.push({ id: String(host.id), label: host.label, ssh: host.ssh ?? null });
  }
  let projects = [];
  if (Array.isArray(parsed.projects) && parsed.projects.every((item) => typeof item === "string")) {
    projects = parsed.projects.map((folder) => ({
      id: `local:${folder}`,
      host: "local",
      path: folder,
      name: path.basename(folder),
    }));
  } else if (Array.isArray(parsed.projects)) {
    projects = parsed.projects.filter((item) => item && typeof item.path === "string" && typeof item.host === "string").map((item) => ({
      id: typeof item.id === "string" ? item.id : `${item.host}:${item.path}`,
      host: item.host,
      path: item.path,
      name: typeof item.name === "string" ? item.name : path.basename(item.path),
      workspace: item.workspace === true,
    }));
  } else if (typeof parsed.root === "string") {
    projects = [{ id: `local:${parsed.root}`, host: "local", path: parsed.root, name: path.basename(parsed.root) }];
  }
  const active = projects.some((item) => item.id === parsed.active)
    ? parsed.active
    : (projects.find((item) => item.path === parsed.active)?.id ?? projects[0]?.id ?? null);
  const activeHost = hosts.some((item) => item.id === parsed.activeHost) ? parsed.activeHost : "local";
  return { hosts, activeHost, projects, active };
}

function adoptCollapsed() {
  const collapsed = collapseSiblingProjects(session.projects, session.active);
  const changed = collapsed.active !== session.active
    || JSON.stringify(collapsed.projects) !== JSON.stringify(session.projects);
  session.projects = collapsed.projects;
  session.active = collapsed.active;
  return changed;
}

async function loadSession() {
  try {
    session = readSession(JSON.parse(await readFile(sessionFile(), "utf8")));
  } catch {
    session = readSession({});
  }
  if (adoptCollapsed()) await saveSession();
}

async function addWorkspace(hostId, folder) {
  const host = session.hosts.find((item) => item.id === hostId) ?? LOCAL_HOST;
  const id = `${host.id}:${folder}`;
  const project = { id, host: host.id, path: folder, name: path.basename(folder), workspace: true };
  session.projects = session.projects.filter((item) => item.id !== id);
  session.projects.push(project);
  session.active = id;
  session.activeHost = host.id;
  adoptCollapsed();
  await saveSession();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#2b2d30",
    title: "Jet Git",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  return win;
}

function send(channel) {
  windowRef?.webContents.send(channel);
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => send("menu:settings") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "Open Repository…", accelerator: "CmdOrCtrl+O", click: () => send("menu:open") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Git",
      submenu: [
        { label: "Update", accelerator: "CmdOrCtrl+T", click: () => send("menu:update") },
        { label: "Commit", accelerator: "CmdOrCtrl+K", click: () => send("menu:commit") },
        { label: "Push", accelerator: "CmdOrCtrl+Shift+K", click: () => send("menu:push") },
        { type: "separator" },
        { label: "Find Action…", accelerator: "Ctrl+Shift+A", click: () => send("menu:actions") },
        { label: "Find Action…", accelerator: "CmdOrCtrl+Shift+A", visible: false, click: () => send("menu:actions") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Find", accelerator: "CmdOrCtrl+F", click: () => send("menu:find") },
        { label: "Compare", accelerator: "CmdOrCtrl+D", click: () => send("menu:compare") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { role: "togglefullscreen" },
      ],
    },
  ]));
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) app.dock.setIcon(appIcon);
  await loadSession();
  await loadSettings();
  nativeTheme.on("updated", () => {
    applyWindowAppearance();
    windowRef?.webContents.send("settings:theme", settingsPayload());
  });
  const fromArg = process.argv.find((arg) => arg.startsWith("--repo="));
  if (fromArg) {
    const folder = fromArg.slice("--repo=".length);
    const roots = await discoverProjects(folder).catch(() => []);
    if (roots.length > 0) await addWorkspace("local", folder);
  }
  buildMenu();
  windowRef = createWindow();
  applyWindowAppearance();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) windowRef = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("settings:get", () => result(settingsPayload()));

ipcMain.handle("settings:set", async (_event, patch = {}) => {
  settings = readSettings({ appearance: { ...settings.appearance, ...(patch.appearance ?? {}) } });
  await saveSettings();
  applyWindowAppearance();
  return result(settingsPayload());
});

ipcMain.handle("repo:initial", () => result(sessionPayload()));

ipcMain.handle("repo:projects", () => result(sessionPayload()));

ipcMain.handle("repo:activate", async (_event, id) => {
  const project = session.projects.find((item) => item.id === id);
  if (!project) return failure(new GitCoreError("Unknown project.", { code: "NOT_A_REPOSITORY" }));
  session.active = project.id;
  session.activeHost = project.host;
  await saveSession();
  return result(sessionPayload());
});

ipcMain.handle("repo:host", async (_event, id) => {
  if (!session.hosts.some((item) => item.id === id)) return failure(new GitCoreError("Unknown host.", { code: "BAD_PATH" }));
  session.activeHost = id;
  await saveSession();
  return result(sessionPayload());
});

ipcMain.handle("repo:host-add", async (_event, name) => {
  const hostName = String(name ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(hostName)) {
    return failure(new GitCoreError("Unsupported host.", { code: "BAD_PATH" }));
  }
  const id = `ssh:${hostName}`;
  if (!session.hosts.some((item) => item.id === id)) {
    session.hosts.push({ id, label: hostName, ssh: hostName });
  }
  session.activeHost = id;
  await saveSession();
  return result(sessionPayload());
});

ipcMain.handle("repo:open", async (_event, payload = {}) => {
  const host = session.hosts.find((item) => item.id === (payload.host || session.activeHost)) ?? LOCAL_HOST;
  let folder = typeof payload.path === "string" ? payload.path.trim() : "";
  if (!folder) {
    if (host.ssh) return failure(new GitCoreError("Remote folder is missing.", { code: "BAD_PATH" }));
    const picked = await dialog.showOpenDialog(windowRef, { properties: ["openDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return result(null);
    folder = picked.filePaths[0];
  }
  if (host.ssh && !folder.startsWith("/")) return failure(new GitCoreError("Remote folder must be absolute.", { code: "BAD_PATH" }));
  try {
    await discoverProjects(locationOf(host, folder));
    await addWorkspace(host.id, folder);
    return result(sessionPayload());
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:browse", async (_event, payload = {}) => {
  try {
    const host = session.hosts.find((item) => item.id === (payload.host || session.activeHost)) ?? LOCAL_HOST;
    const folder = typeof payload.path === "string" && payload.path.trim() ? payload.path.trim() : "/";
    return result(await browseDirectory(locationOf(host, folder)));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:paths", async (_event, payload = {}) => {
  try {
    return result(await listPaths(payload.root, payload.prefix ?? ""));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:pick", async () => {
  const host = session.hosts.find((item) => item.id === session.activeHost) ?? LOCAL_HOST;
  if (host.ssh) return result({ remote: true, host: host.id, label: host.label });
  const picked = await dialog.showOpenDialog(windowRef, { properties: ["openDirectory"] });
  if (picked.canceled || !picked.filePaths[0]) return result(null);
  try {
    await discoverProjects(picked.filePaths[0]);
    await addWorkspace(host.id, picked.filePaths[0]);
    return result(sessionPayload());
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("clip:write", (_event, text) => {
  if (typeof text !== "string" || text.length > 4000) return result(false);
  clipboard.writeText(text);
  return result(true);
});

ipcMain.handle("repo:view", async (_event, payload = {}) => {
  try {
    const project = session.projects.find((item) => item.id === (payload.project || session.active));
    if (!project) return failure(new GitCoreError("Repository path is missing.", { code: "NOT_A_REPOSITORY" }));
    const host = session.hosts.find((item) => item.id === project.host) ?? LOCAL_HOST;
    let roots = await discoverProjects(locationOf(host, project.path));
    const catalog = roots.map((root) => ({
      root,
      name: path.basename(root.startsWith("ssh://") ? root.slice(root.indexOf("/", "ssh://".length)) : root),
    }));
    if (payload.repo) roots = roots.filter((item) => item === payload.repo);
    else if (Array.isArray(payload.repos)) {
      const allowed = new Set(payload.repos.filter((item) => typeof item === "string"));
      roots = roots.filter((item) => allowed.has(item));
    }
    let pathspec = payload.path || null;
    if (!Array.isArray(payload.repos) && !pathspec && !payload.repo && payload.repository) {
      const needle = String(payload.repository).toLowerCase();
      const matched = roots.filter((item) => item.toLowerCase().includes(needle) || path.basename(item).toLowerCase().includes(needle));
      if (matched.length > 0) roots = matched;
      else pathspec = payload.repository;
    }
    if (roots.length === 0) {
      if (Array.isArray(payload.repos)) {
        return result({ rows: [], repos: [], catalog, authors: [], truncated: false, branches: null, head: null });
      }
      return failure(new GitCoreError("Not a git repository.", { code: "NOT_A_REPOSITORY" }));
    }
    return result({ ...(await loadWorkspaceView(roots, { ...payload, path: pathspec })), catalog });
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:commit", async (_event, payload = {}) => {
  try {
    return result(await loadCommitDetail(payload.root, payload.hash));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:diff", async (_event, payload = {}) => {
  try {
    return result(await loadFileDiff(payload.root, payload.hash, payload.file));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:checkout", async (_event, payload = {}) => {
  try {
    return result(await checkoutRevision(payload.root, payload.rev));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:compare", async (_event, payload = {}) => {
  try {
    return result(await compareRevisions(payload.root, payload.from, payload.to));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:compare-file", async (_event, payload = {}) => {
  try {
    return result(await compareFile(payload.root, payload.from, payload.to, payload.file));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:selection", async (_event, payload = {}) => {
  try {
    return result(await loadSelection(payload.root, payload.hashes, payload.focus));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:selection-diff", async (_event, payload = {}) => {
  try {
    return result(await loadSelectionDiff(payload.root, payload.hashes, payload.file));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:changes", async (_event, payload = {}) => {
  try {
    return result(await loadChanges(payload.root));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:working-diff", async (_event, payload = {}) => {
  try {
    return result(await loadWorkingDiff(payload.root, payload.file));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:stage", async (_event, payload = {}) => {
  try {
    return result(await setStaged(payload.root, payload.file, payload.staged === true));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:review-load", async (_event, payload = {}) => {
  try {
    return result(await loadReview(payload.root));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:review-commit", async (_event, payload = {}) => {
  try {
    return result(await commitReview(payload.root, payload.review));
  } catch (error) {
    return failure(error);
  }
});

function reviewFileName(branch) {
  const cleaned = String(branch || "review")
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${cleaned || "review"}.json`;
}

ipcMain.handle("repo:review-export", async (_event, payload = {}) => {
  try {
    const text = `${JSON.stringify(payload.review, null, 2)}\n`;
    const picked = await dialog.showSaveDialog(windowRef, { defaultPath: reviewFileName(payload.review?.branch) });
    if (picked.canceled || !picked.filePath) return result({ canceled: true });
    await writeFile(picked.filePath, text);
    return result({ file: picked.filePath });
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:saved", async (_event, payload = {}) => {
  try {
    return result(await listSaved(payload.root));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:saved-patch", async (_event, payload = {}) => {
  try {
    return result(await savedPatch(payload.root, payload.kind, payload.id, payload.file));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:saved-apply", async (_event, payload = {}) => {
  try {
    return result(await applySaved(payload.root, payload.kind, payload.id, payload.remove === true));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:saved-drop", async (_event, payload = {}) => {
  try {
    return result(await dropSaved(payload.root, payload.kind, payload.id));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:commit-changes", async (_event, payload = {}) => {
  try {
    return result(await commitChanges(payload.root, { message: payload.message, amend: payload.amend === true }));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:push", async (_event, payload = {}) => {
  try {
    return result(await pushHead(payload.root));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:pull", async (_event, payload = {}) => {
  try {
    return result(await pullHead(payload.root));
  } catch (error) {
    return failure(error);
  }
});

const repoActions = {
  revert: (payload) => (payload.hashes ? revertCommits(payload.root, payload.hashes) : revertCommit(payload.root, payload.hash)),
  reset: (payload) => resetTo(payload.root, payload.hash, payload.mode),
  drop: (payload) => dropCommits(payload.root, payload.hashes ?? [payload.hash]),
  "push-up-to": (payload) => pushUpTo(payload.root, payload.hash),
  "create-patch": async (payload) => {
    const hashes = payload.hashes ?? [payload.hash];
    const text = await createPatch(payload.root, hashes);
    const picked = await dialog.showSaveDialog(windowRef, { defaultPath: `${String(hashes[0] ?? "commit").slice(0, 8)}.patch` });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    await writeFile(picked.filePath, text);
    return { file: picked.filePath };
  },
  "cherry-pick": (payload) => cherryPick(payload.root, payload.hash),
  rebase: (payload) => rebaseOnto(payload.root, payload.upstream),
  merge: (payload) => mergeRef(payload.root, payload.ref),
  squash: (payload) => squashCommits(payload.root, payload.hashes, payload.message),
  fetch: (payload) => fetchRemotes(payload.root),
  stash: (payload) => stashSave(payload.root, payload.message),
  "stash-pop": (payload) => stashPop(payload.root),
  discard: (payload) => discardPath(payload.root, payload.file),
  "delete-branch": (payload) => deleteBranch(payload.root, payload.ref),
  "create-tag": (payload) => createTag(payload.root, payload.name, payload.hash),
  "delete-tag": (payload) => deleteTag(payload.root, payload.name),
  resolve: (payload) => resolveSide(payload.root, payload.file, payload.side),
  continue: (payload) => continueOperation(payload.root),
  abort: (payload) => abortOperation(payload.root),
};

ipcMain.handle("repo:action", async (_event, payload = {}) => {
  const run = repoActions[payload.action];
  if (!run) return failure(new GitCoreError("Unknown action.", { code: "GIT_ERROR" }));
  try {
    return result(await run(payload));
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle("repo:branch-create", async (_event, payload = {}) => {
  try {
    return result(await createBranch(payload.root, payload.name, payload.start));
  } catch (error) {
    return failure(error);
  }
});
