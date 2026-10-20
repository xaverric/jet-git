const LANE_COLORS = ["#6b9eff", "#3fa36a", "#c084fc", "#e0a15a", "#ef6b73", "#2eb8b0", "#d4b15a", "#d47cba"];
const ROW = 24;
const COL = 14;

const state = {
  root: null,
  view: null,
  rev: null,
  search: "",
  path: "",
  pathLabel: "",
  dateLabel: "",
  branchQuery: "",
  branchLabel: "",
  repoLabel: "",
  knownAuthors: [],
  limit: 400,
  selected: null,
  detail: null,
  file: null,
  diff: null,
  error: null,
  loading: false,
  collapsed: new Set(),
  tab: "log",
  branchesWidth: 268,
  detailsWidth: 380,
  diffSplit: 50,
  projects: [],
  hosts: [{ id: "local", label: "This Mac", ssh: null }],
  activeHost: "local",
  projectId: null,
  repo: null,
  author: "",
  since: "",
  until: "",
  compareBase: null,
  compare: null,
  selection: [],
  anchor: null,
  files: [],
  editor: null,
  collapsedDirs: new Set(),
  changes: null,
  workFile: null,
  branchFrom: null,
  shownRepos: null,
  stashes: [],
  shelves: [],
  saved: null,
  notice: null,
  settings: { theme: "dark", translucent: false, fontSize: 12, syntax: true },
  systemDark: true,
};

const branchInput = document.querySelector("#branch");
const searchInput = document.querySelector("#search");
const pathsInput = document.querySelector("#paths");
const branchList = document.querySelector("#branches");
const log = document.querySelector("#log");
const detail = document.querySelector("#detail");
const statusBar = document.querySelector("#status");
const gitPane = document.querySelector("#git-pane");
const branchClear = document.querySelector("#branch-clear");
const hostPicker = document.querySelector("#host-picker");
const projectPicker = document.querySelector("#project-picker");
const repoPicker = document.querySelector("#repo-picker");
const userInput = document.querySelector("#user");
const dateInput = document.querySelector("#date");
const pathsClear = document.querySelector("#paths-clear");
const suggest = document.querySelector("#suggest");
const menu = document.querySelector("#menu");
const detailTitle = document.querySelector("#detail-title");
const detailName = document.querySelector("#detail-name");
const detailCount = document.querySelector("#detail-count");
const commitPreview = document.querySelector("#commit-preview");
const editorPane = document.querySelector("#editor");
const editorTitle = document.querySelector("#editor-title");
const editorPath = document.querySelector("#editor-path");
const diffFilePos = document.querySelector("#diff-file-pos");
const diffCount = document.querySelector("#diff-count");
const diffPrevFile = document.querySelector("#diff-prev-file");
const diffNextFile = document.querySelector("#diff-next-file");
const diffPrev = document.querySelector("#diff-prev");
const diffNext = document.querySelector("#diff-next");
const editorBody = document.querySelector("#editor-body");
const editorSplitter = document.querySelector("#editor-splitter");
const workspace = document.querySelector("#workspace");
const changesList = document.querySelector("#changes");
const changesBranch = document.querySelector("#changes-branch");
const changesSync = document.querySelector("#changes-sync");
const branchFromLabel = document.querySelector("#branch-from");
const branchFromClear = document.querySelector("#branch-from-clear");
const newBranchInput = document.querySelector("#new-branch");
const commitMessage = document.querySelector("#commit-message");
const amendInput = document.querySelector("#amend");
const conflictBar = document.querySelector("#conflict-bar");
const conflictLabel = document.querySelector("#conflict-label");
const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

let requestId = 0;
let selectionToken = 0;
let editorToken = 0;
let actionBusy = false;

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatExact(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} at ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function baseName(root) {
  const parts = root.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

function color(index) {
  return LANE_COLORS[index % LANE_COLORS.length];
}

function drawGraph(row) {
  const width = Math.max(row.columnCount, 1) * COL + 8;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(ROW));
  svg.setAttribute("viewBox", `0 0 ${width} ${ROW}`);
  const x = (lane) => 8 + lane * COL + COL / 2;
  const mid = ROW / 2;
  const paint = (x1, y1, x2, y2, stroke) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", x1 === x2 ? "line" : "path");
    if (x1 === x2) {
      element.setAttribute("x1", String(x1));
      element.setAttribute("y1", String(y1));
      element.setAttribute("x2", String(x2));
      element.setAttribute("y2", String(y2));
    } else {
      const midY = (y1 + y2) / 2;
      element.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      element.setAttribute("fill", "none");
    }
    element.setAttribute("stroke", stroke);
    element.setAttribute("stroke-width", "2");
    svg.append(element);
  };
  for (const line of row.lines) {
    const stroke = color(line.color);
    if (line.type === "through") paint(x(line.lane), 0, x(line.lane), ROW, stroke);
    if (line.type === "down") paint(x(row.lane), mid, x(line.toLane), ROW, stroke);
    if (line.type === "into") paint(x(line.fromLane), 0, x(row.lane), mid, stroke);
  }
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", String(x(row.lane)));
  dot.setAttribute("cy", String(mid));
  dot.setAttribute("r", "4");
  dot.setAttribute("fill", color(row.color));
  svg.append(dot);
  return svg;
}

function wordStart(text, index) {
  if (index <= 0) return true;
  const prev = text[index - 1];
  const char = text[index];
  if (/[^A-Za-z0-9]/.test(prev)) return true;
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(char);
}

function matchesName(pattern, text) {
  const query = String(pattern ?? "").trim();
  if (!query) return true;
  const name = String(text ?? "");
  if (name.toLowerCase().includes(query.toLowerCase())) return true;
  let from = 0;
  for (const char of query) {
    if (char === " ") continue;
    const want = char.toLowerCase();
    let found = -1;
    for (let index = from; index < name.length; index += 1) {
      if (name[index].toLowerCase() !== want || !wordStart(name, index)) continue;
      found = index;
      break;
    }
    if (found < 0) return false;
    from = found + 1;
  }
  return true;
}

function filterTree(nodes, needle) {
  if (!needle) return nodes;
  const matched = [];
  for (const node of nodes) {
    const children = filterTree(node.children ?? [], needle);
    const self = matchesName(needle, node.label);
    if (self || children.length > 0) matched.push({ ...node, children: self ? node.children : children });
  }
  return matched;
}

function leafCount(nodes) {
  let count = 0;
  for (const node of nodes ?? []) {
    if (node.ref) count += 1;
    count += leafCount(node.children);
  }
  return count;
}

function renderLocalChanges() {
  branchList.append(groupLabel("Local changes"));
  const files = state.changes?.files ?? [];
  if (!state.changes) return;
  if (files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "group";
    empty.textContent = "Working tree clean";
    branchList.append(empty);
    return;
  }
  for (const file of files.slice(0, 8)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "branch local-change";
    const label = document.createElement("span");
    label.className = `label ${statusClass(file.status)}`;
    label.textContent = file.path;
    button.append(label);
    button.addEventListener("click", () => {
      state.tab = "git";
      render();
      openWorkingFile(file.path);
    });
    branchList.append(button);
  }
  if (files.length > 8) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "branch";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `${files.length - 8} more in Git`;
    more.append(label);
    more.addEventListener("click", () => {
      state.tab = "git";
      render();
    });
    branchList.append(more);
  }
}

function branchRow(node, depth) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "branch";
  if (node.ref && node.ref === state.rev) button.classList.add("selected");
  if (node.current) button.classList.add("current");
  button.style.paddingLeft = `${8 + depth * 14}px`;
  const twist = document.createElement("span");
  twist.className = "twist";
  const hasChildren = (node.children ?? []).length > 0;
  twist.textContent = hasChildren ? (state.collapsed.has(node.id) ? "▸" : "▾") : "";
  const mark = document.createElement("span");
  if (node.current) mark.className = "mark";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = node.label;
  button.append(twist, mark, label);
  if (node.current) {
    const badge = document.createElement("span");
    badge.className = "current-badge";
    badge.textContent = "current";
    button.append(badge);
  }
  button.addEventListener("click", () => {
    if (hasChildren) {
      if (state.collapsed.has(node.id)) state.collapsed.delete(node.id);
      else state.collapsed.add(node.id);
    }
    if (node.ref) {
      state.rev = node.ref;
      if (node.root) state.repo = node.root;
      state.branchQuery = "";
      branchInput.value = refLabel(node.ref);
      closePopups();
      reload();
      return;
    }
    renderBranches();
  });
  button.addEventListener("contextmenu", (event) => {
    if (!node.ref) return;
    event.preventDefault();
    openMenu(event.clientX, event.clientY, branchActions(node));
  });
  return button;
}

function stamped(nodes, root) {
  return (nodes ?? []).map((node) => ({ ...node, root: node.root ?? root, children: stamped(node.children, root) }));
}

function appendTree(container, nodes, depth) {
  for (const node of nodes) {
    container.append(branchRow(node, depth));
    if ((node.children ?? []).length > 0 && !state.collapsed.has(node.id)) {
      appendTree(container, node.children, depth + 1);
    }
  }
}

function groupLabel(text) {
  const label = document.createElement("div");
  label.className = "group";
  label.textContent = text;
  return label;
}

function catalogRepos() {
  return state.view?.catalog ?? state.view?.repos ?? [];
}

function toggleShownRepo(root) {
  const catalog = catalogRepos();
  const current = new Set(state.shownRepos ?? catalog.map((repo) => repo.root));
  if (current.has(root)) {
    if (current.size === 1) return;
    current.delete(root);
  } else current.add(root);
  state.shownRepos = current.size === catalog.length ? null : [...current];
  state.repo = null;
  reload();
}

function renderRepositories() {
  const repos = catalogRepos();
  if (repos.length === 0) return;
  branchList.append(groupLabel("Repositories"));
  if (repos.length > 1) {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "branch";
    if (!state.shownRepos && !state.repo) all.classList.add("current");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "All";
    all.append(label);
    all.addEventListener("click", () => {
      state.shownRepos = null;
      state.repo = null;
      reload();
    });
    branchList.append(all);
  }
  for (const repo of repos) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "branch";
    const picked = state.shownRepos ? state.shownRepos.includes(repo.root) : state.repo === repo.root;
    if (picked) button.classList.add("current");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = repo.name;
    button.append(label);
    button.addEventListener("click", () => toggleShownRepo(repo.root));
    branchList.append(button);
  }
}

function renderBranches() {
  branchList.replaceChildren();
  renderLocalChanges();
  renderRepositories();
  const repos = state.view?.repos ?? [];
  if (repos.length > 1) {
    const needle = state.branchQuery.trim();
    for (const repo of repos) {
      branchList.append(groupLabel(repo.name));
      appendTree(branchList, stamped(filterTree(repo.branches?.local ?? [], needle), repo.root), 0);
      for (const remote of repo.branches?.remotes ?? []) {
        appendTree(branchList, stamped(filterTree(remote.children ?? [], needle), repo.root), 0);
      }
    }
    branchClear.hidden = !state.rev;
    return;
  }
  const panel = state.view?.branches;
  if (!panel) return;
  const needle = state.branchQuery.trim();
  branchList.append(groupLabel("HEAD (Current branch)"));
  branchList.append(branchRow({
    id: "head",
    label: panel.head.label,
    ref: panel.head.ref,
    current: true,
    children: [],
  }, 0));
  branchList.append(groupLabel("Local"));
  appendTree(branchList, filterTree(panel.local, needle), 0);
  if (panel.remotes.length > 0) {
    branchList.append(groupLabel("Remote"));
    for (const remote of panel.remotes) {
      const remoteNode = { id: remote.id, label: remote.name, ref: null, children: filterTree(remote.children, needle) };
      if (needle && remoteNode.children.length === 0 && !matchesName(needle, remote.name)) continue;
      branchList.append(branchRow(remoteNode, 0));
      if (!state.collapsed.has(remote.id)) appendTree(branchList, remoteNode.children, 1);
    }
  }
  const tagCount = leafCount(panel.tags);
  branchList.append(groupLabel(tagCount ? `Tags (${tagCount})` : "Tags"));
  if (tagCount === 0) {
    const empty = document.createElement("div");
    empty.className = "group";
    empty.textContent = "No tags";
    branchList.append(empty);
  } else {
    appendTree(branchList, filterTree(panel.tags, needle), 0);
  }
  branchClear.hidden = !state.rev;
}

function renderLog() {
  const scroll = log.scrollTop;
  log.replaceChildren();
  const rows = state.view?.rows ?? [];
  if (!state.projectId) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const text = document.createElement("p");
    text.textContent = "Open a project to see its history.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open repository";
    button.addEventListener("click", pickRepository);
    empty.append(text, button);
    log.append(empty);
    return;
  }
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.loading ? "Loading…" : (state.shownRepos?.length === 0 ? "No repositories selected." : "No commits.");
    log.append(empty);
    return;
  }
  const width = Math.max(rows[0].columnCount, 1) * COL + 8;
  log.style.setProperty("--graph", `${width}px`);
  const head = document.createElement("div");
  head.className = "row head";
  for (const title of ["", "Subject", "Author", "Date", "Hash"]) {
    const cell = document.createElement("span");
    cell.textContent = title;
    head.append(cell);
  }
  log.append(head);
  const tags = tagIndex();
  for (const row of rows) {
    const element = document.createElement("div");
    element.className = "row";
    element.dataset.hash = row.hash;
    if (state.selection.includes(row.hash)) element.classList.add("selected");
    const graph = document.createElement("div");
    graph.className = "graph";
    graph.append(drawGraph(row));
    const message = document.createElement("div");
    message.className = "message";
    const seen = new Set();
    for (const decoration of row.decorations ?? []) {
      seen.add(decoration.name);
      const chip = document.createElement("span");
      chip.className = decoration.tag ? "chip tag" : "chip";
      chip.textContent = decoration.name;
      message.append(chip);
    }
    for (const name of tags.get(row.hash) ?? []) {
      if (seen.has(name)) continue;
      const chip = document.createElement("span");
      chip.className = "chip tag";
      chip.textContent = name;
      message.append(chip);
    }
    if ((state.view?.repos?.length ?? 0) > 1 && row.repo) {
      const repo = document.createElement("span");
      repo.className = "chip repo";
      repo.textContent = row.repo;
      message.append(repo);
    }
    const subject = document.createElement("span");
    subject.className = "subject";
    subject.textContent = row.subject;
    message.append(subject);
    const author = document.createElement("div");
    author.className = "author";
    author.textContent = row.authorName;
    const date = document.createElement("div");
    date.className = "date";
    date.textContent = formatDate(row.authoredAt);
    const hash = document.createElement("div");
    hash.className = "hash";
    hash.textContent = row.hash.slice(0, 8);
    element.append(graph, message, author, date, hash);
    element.addEventListener("click", (event) => selectCommits(row.hash, event));
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(event.clientX, event.clientY, commitActions(row));
    });
    log.append(element);
  }
  if (state.view.truncated) {
    const more = document.createElement("div");
    more.className = "more";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Load older commits";
    button.addEventListener("click", () => {
      state.limit += 400;
      reload();
    });
    more.append(button);
    log.append(more);
  }
  log.scrollTop = scroll;
}

function buildTree(files) {
  const root = { name: "", path: "", children: new Map(), file: null };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, index) => {
      const childPath = parts.slice(0, index + 1).join("/");
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: childPath, children: new Map(), file: null };
        node.children.set(part, child);
      }
      node = child;
      if (index === parts.length - 1) node.file = file;
    });
  }
  return root;
}

function fileCount(node) {
  let count = node.file ? 1 : 0;
  for (const child of node.children.values()) count += fileCount(child);
  return count;
}

function sortedChildren(node) {
  return [...node.children.values()].sort((left, right) => {
    const leftDir = left.children.size > 0;
    const rightDir = right.children.size > 0;
    if (leftDir !== rightDir) return leftDir ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function statusClass(status) {
  if (status === "?" || status === "A") return "A";
  if (status === "D") return "D";
  return "M";
}

function renderTreeNodes(node, depth, parent) {
  for (const child of sortedChildren(node)) {
    const directory = child.children.size > 0;
    const collapsed = state.collapsedDirs.has(child.path);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tree-row";
    row.style.paddingLeft = `${8 + depth * 14}px`;
    const twist = document.createElement("span");
    twist.className = "twist";
    twist.textContent = directory ? (collapsed ? "▸" : "▾") : "";
    const label = document.createElement("span");
    label.className = "name";
    if (!directory && child.file) label.classList.add(statusClass(child.file.status));
    label.textContent = child.name;
    row.append(twist, label);
    if (directory) {
      const count = document.createElement("span");
      count.className = "count";
      const total = fileCount(child);
      count.textContent = total === 1 ? "1 file" : `${total} files`;
      row.append(count);
      row.addEventListener("click", () => {
        if (state.collapsedDirs.has(child.path)) state.collapsedDirs.delete(child.path);
        else state.collapsedDirs.add(child.path);
        renderDetail();
      });
    } else {
      if (state.editor?.path === child.path) row.classList.add("selected");
      row.addEventListener("click", () => openTreeFile(child.file));
    }
    parent.append(row);
    if (directory && !collapsed) renderTreeNodes(child, depth + 1, parent);
  }
}

function renderFileTree(files) {
  detailName.textContent = rowByHash(state.selected)?.repo || currentProject()?.name || "";
  detailCount.textContent = files.length === 1 ? "1 file" : `${files.length} files`;
  detail.replaceChildren();
  if (files.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = state.selection.length || state.compare ? "No files" : "Select commits to view files";
    detail.append(placeholder);
    return;
  }
  renderTreeNodes(buildTree(files), 0, detail);
}

function showRevision(root, rev, label) {
  state.repo = root || state.repo;
  state.rev = rev;
  state.branchQuery = "";
  state.branchLabel = label || refLabel(rev);
  branchInput.value = state.branchLabel;
  closePopups();
  reload();
}

function renderCommitPreview() {
  commitPreview.replaceChildren();
  if (state.compare) {
    commitPreview.hidden = false;
    const title = document.createElement("h2");
    title.textContent = `${state.compare.from.slice(0, 8)} → ${state.compare.to.slice(0, 8)}`;
    commitPreview.append(title);
    return;
  }
  const commit = state.detail;
  if (!commit) {
    commitPreview.hidden = true;
    return;
  }
  commitPreview.hidden = false;
  const title = document.createElement("h2");
  title.textContent = commit.subject;
  commitPreview.append(title);
  if (commit.body) {
    const body = document.createElement("p");
    body.className = "commit-body";
    body.textContent = commit.body;
    commitPreview.append(body);
  }
  const identity = document.createElement("p");
  identity.className = "identity";
  const hash = document.createElement("button");
  hash.type = "button";
  hash.className = "link";
  hash.textContent = commit.hash.slice(0, 8);
  hash.addEventListener("click", () => window.jetGit.copyText(commit.hash));
  const who = document.createElement("span");
  who.textContent = `${commit.authorName} <${commit.authorEmail}>`;
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = `on ${formatExact(commit.authoredAt)}`;
  identity.append(hash, who, when);
  const branches = document.createElement("p");
  branches.className = "branch-line";
  const names = commit.branches ?? [];
  const noun = names.length === 1 ? "branch" : "branches";
  const lead = document.createElement("span");
  lead.textContent = names.length ? `In ${names.length} ${noun}: ` : "Not on any branch";
  branches.append(lead);
  for (const name of names) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "branch-link";
    link.textContent = name;
    link.addEventListener("click", () => {
      if (name === "HEAD") return;
      const rev = name.includes("/") ? `refs/remotes/${name}` : `refs/heads/${name}`;
      showRevision(commit.root || activeRoot(), rev, name);
    });
    branches.append(link);
  }
  commitPreview.append(identity, branches);
}

function renderDetail() {
  const files = state.compare ? (state.compare.files ?? []) : (state.files ?? []);
  renderFileTree(files);
  renderCommitPreview();
}

function renderStatus() {
  statusBar.replaceChildren();
  if (state.error) {
    const error = document.createElement("span");
    error.className = "error";
    error.textContent = state.error;
    statusBar.append(error);
    return;
  }
  if (!state.view) return;
  const repo = document.createElement("span");
  repo.textContent = state.view.root ? baseName(state.view.root) : "";
  const branch = document.createElement("span");
  branch.textContent = !state.view.head ? "" : (state.view.head.detached ? "detached" : (state.view.head.name ?? ""));
  const count = document.createElement("span");
  const shown = state.view.rows.length;
  const noun = shown === 1 ? "commit" : "commits";
  count.textContent = state.view.truncated ? `${shown}+ ${noun}` : `${shown} ${noun}`;
  statusBar.append(repo, branch, count);
  if (state.compareBase) {
    const marked = document.createElement("span");
    marked.textContent = `compare ${state.compareBase.slice(0, 8)}`;
    statusBar.append(marked);
  }
  if (state.notice) {
    const note = document.createElement("span");
    note.textContent = state.notice;
    statusBar.append(note);
  }
}

function viewedRepos() {
  const repos = state.view?.repos ?? [];
  if (state.repo) return repos.filter((repo) => repo.root === state.repo);
  return repos;
}

function checkoutName(repo) {
  if (!repo?.head) return "";
  if (repo.head.detached) return repo.head.hash ? `detached ${repo.head.hash.slice(0, 8)}` : "detached";
  return repo.head.name || "";
}

function renderScope() {
  const branch = document.querySelector("#scope-name");
  const branchMark = document.querySelector("#scope-branch");
  const detail = document.querySelector("#scope-detail");
  const field = branchInput.closest(".field");
  const repos = viewedRepos();
  const project = currentProject();
  const names = [...new Set(repos.map(checkoutName).filter(Boolean))];
  const listed = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  const checkout = names.length === 1 ? names[0] : listed;
  const showing = state.rev ? (state.branchLabel || refLabel(state.rev)) : "";
  const total = state.view?.catalog?.length ?? repos.length;
  const where = total > repos.length
    ? `${repos.length} of ${total} repositories`
    : (repos.length === 1
      ? repos[0].name
      : (project ? `all repositories in ${project.name}` : "all repositories"));
  const extra = [state.author, state.since && `since ${state.since}`, state.until && `until ${state.until}`].filter(Boolean);
  branchMark.classList.toggle("filtered", Boolean(showing));
  if (showing) {
    branch.textContent = showing;
    const bits = ["showing this branch"];
    if (checkout && checkout !== showing) bits.push(`checked out ${checkout}`);
    bits.push(where, ...extra);
    detail.textContent = bits.join("  ·  ");
  } else if (checkout) {
    branch.textContent = checkout;
    detail.textContent = ["checked out", where, ...extra].join("  ·  ");
  } else {
    branch.textContent = "No branch";
    detail.textContent = [where, ...extra].filter(Boolean).join("  ·  ");
  }
  const single = names.length === 1 ? names[0] : "";
  field.classList.toggle("filtered", Boolean(state.rev));
  field.classList.toggle("checked-out", !state.rev && Boolean(single));
  if (document.activeElement !== branchInput) {
    branchInput.value = showing || single;
    branchInput.placeholder = single ? "" : "Branch";
  }
}

function render() {
  document.documentElement.style.setProperty("--branches-width", `${state.branchesWidth}px`);
  document.documentElement.style.setProperty("--details-width", `${state.detailsWidth}px`);
  renderPickers();
  renderScope();
  pathsClear.hidden = !state.path;
  const logTab = state.tab === "log";
  log.hidden = !logTab;
  gitPane.hidden = logTab;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === state.tab);
  });
  const gitCount = document.querySelector("#git-count");
  const changed = state.changes?.files.length ?? 0;
  gitCount.hidden = changed === 0;
  gitCount.textContent = String(changed);
  renderBranches();
  renderLog();
  renderDetail();
  renderEditor();
  renderStatus();
}

function monogram(name) {
  const words = String(name || "").replace(/[_./-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const text = (words.length > 1 ? `${words[0][0]}${words[1][0]}` : String(name || "–").slice(0, 2)).toUpperCase();
  const colors = ["#3d6b4f", "#3d5a80", "#6b4f3d", "#5a3d6b", "#3d6b6b", "#6b5a3d"];
  let hash = 0;
  for (const char of String(name || "")) hash = (hash + char.charCodeAt(0)) % colors.length;
  return { text, color: colors[hash] };
}

function currentProject() {
  return state.projects.find((item) => item.id === state.projectId) ?? null;
}

function renderPickers() {
  const host = state.hosts.find((item) => item.id === state.activeHost);
  hostPicker.textContent = host?.label ?? "This Mac";
  const project = currentProject();
  const mark = monogram(project?.name ?? "");
  const badge = projectPicker.querySelector(".mono");
  const label = projectPicker.querySelector(".picker-label");
  badge.textContent = project ? mark.text : "–";
  badge.style.background = mark.color;
  label.textContent = project?.name ?? "Workspace";
  const catalog = state.view?.catalog ?? [];
  const repoLabel = repoPicker.querySelector(".picker-label");
  if (catalog.length === 0) repoLabel.textContent = "Repositories";
  else if (catalog.length === 1) repoLabel.textContent = catalog[0].name;
  else if (!state.shownRepos) repoLabel.textContent = `All ${catalog.length}`;
  else if (state.shownRepos.length === 0) repoLabel.textContent = "None";
  else if (state.shownRepos.length === 1) {
    repoLabel.textContent = catalog.find((repo) => repo.root === state.shownRepos[0])?.name ?? "1 repository";
  } else repoLabel.textContent = `${state.shownRepos.length} of ${catalog.length}`;
}

async function reload() {
  if (!state.projectId) {
    render();
    return;
  }
  const id = ++requestId;
  state.loading = true;
  state.error = null;
  state.notice = null;
  renderStatus();
  const response = await window.jetGit.loadView({
    project: state.projectId,
    repo: state.repo,
    repos: state.shownRepos,
    rev: state.rev,
    search: state.search,
    path: state.path,
    author: state.author,
    since: state.since,
    until: state.until,
    limit: state.limit,
  });
  if (id !== requestId) return;
  state.loading = false;
  if (!response.ok) {
    state.error = response.error;
    state.view = null;
    render();
    return;
  }
  state.view = response.data;
  const catalogRoots = new Set((response.data.catalog ?? []).map((repo) => repo.root));
  if (state.shownRepos) {
    state.shownRepos = state.shownRepos.filter((root) => catalogRoots.has(root));
    if (catalogRoots.size > 0 && state.shownRepos.length === catalogRoots.size) state.shownRepos = null;
  }
  const seen = new Set(state.knownAuthors);
  for (const name of response.data.authors ?? []) seen.add(name);
  for (const row of response.data.rows ?? []) if (row.authorName) seen.add(row.authorName);
  state.knownAuthors = [...seen].sort((left, right) => left.localeCompare(right));
  state.root = activeRoot();
  const visible = new Set(response.data.rows.map((row) => row.hash));
  state.selection = state.selection.filter((hash) => visible.has(hash));
  if (state.selected && !visible.has(state.selected)) state.selected = state.selection[0] ?? null;
  if (!state.anchor || !visible.has(state.anchor)) state.anchor = state.selected;
  if (state.selection.length === 0) {
    state.detail = null;
    state.files = [];
  }
  render();
  await loadWorktree();
  if (state.selection.length > 0) await loadSelectionData();
}

function orderedSelection() {
  const picked = new Set(state.selection);
  return (state.view?.rows ?? []).map((row) => row.hash).filter((hash) => picked.has(hash));
}

function rowByHash(hash) {
  return (state.view?.rows ?? []).find((row) => row.hash === hash);
}

function activeRoot() {
  return rowByHash(state.selected)?.root || state.repo || state.view?.repos?.[0]?.root || state.root;
}

function sameRepoSelection() {
  const root = activeRoot();
  return orderedSelection().filter((hash) => rowByHash(hash)?.root === root);
}

function selectCommits(hash, event) {
  const rows = state.view?.rows ?? [];
  if (event.shiftKey && state.anchor) {
    const start = rows.findIndex((row) => row.hash === state.anchor);
    const end = rows.findIndex((row) => row.hash === hash);
    if (start >= 0 && end >= 0) {
      const [from, to] = start < end ? [start, end] : [end, start];
      state.selection = rows.slice(from, to + 1).map((row) => row.hash);
    }
  } else if (event.metaKey || event.ctrlKey) {
    const picked = new Set(state.selection);
    if (picked.has(hash)) picked.delete(hash);
    else picked.add(hash);
    state.selection = rows.map((row) => row.hash).filter((item) => picked.has(item));
    if (state.selection.length === 0) state.selection = [hash];
    state.anchor = hash;
  } else {
    state.selection = [hash];
    state.anchor = hash;
  }
  state.selected = state.selection.includes(hash) ? hash : state.selection[0];
  const picked = rowByHash(state.selected);
  if (picked?.root) state.root = picked.root;
  state.compare = null;
  renderLog();
  loadSelectionData();
}

async function selectCommit(hash) {
  const row = rowByHash(hash);
  if (row?.root) state.root = row.root;
  state.selected = hash;
  state.anchor = hash;
  state.selection = [hash];
  state.compare = null;
  renderLog();
  await loadSelectionData();
  log.querySelector(`[data-hash="${hash}"]`)?.scrollIntoView({ block: "nearest" });
}

async function loadSelectionData() {
  const focus = state.selected;
  const root = rowByHash(focus)?.root || activeRoot();
  const hashes = sameRepoSelection();
  state.root = root;
  if (!root || hashes.length === 0 || !focus) {
    state.files = [];
    state.detail = null;
    state.fileDiffs = {};
    renderDetail();
    return;
  }
  const token = ++selectionToken;
  const response = await window.jetGit.selection({ root, hashes, focus });
  if (token !== selectionToken) return;
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.files = response.data.files;
  state.fileDiffs = response.data.diffs ?? {};
  state.detail = { ...response.data.commit, root };
  if (state.editor && state.editor.kind === "selection") {
    if (state.files.some((file) => file.path === state.editor.path)) openSelectionFile(state.editor.path);
    else closeEditor();
  }
  renderDetail();
}

async function selectFile(file) {
  state.file = file;
  state.diff = null;
  renderDetail();
  const response = await window.jetGit.loadDiff({ root: state.root, hash: state.selected, file });
  if (state.file !== file) return;
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.diff = response.data;
  widenDetails();
  renderDetail();
}

async function openBrowser(host, label, folder) {
  state.browseHost = host;
  const pane = document.querySelector("#browse");
  document.querySelector("#browse-title").textContent = `Open on ${label}`;
  pane.hidden = false;
  await loadBrowser(folder || "/");
}

async function loadBrowser(folder) {
  const list = document.querySelector("#browse-list");
  const pathLine = document.querySelector("#browse-path");
  list.replaceChildren();
  pathLine.textContent = "Loading…";
  const response = await window.jetGit.browse({ host: state.browseHost, path: folder });
  list.replaceChildren();
  if (!response.ok) {
    pathLine.textContent = folder;
    const error = document.createElement("div");
    error.className = "placeholder";
    error.textContent = response.error;
    list.append(error);
    return;
  }
  state.browsePath = response.data.path;
  state.browseParent = response.data.parent;
  pathLine.textContent = response.data.path;
  document.querySelector("#browse-up").disabled = !response.data.parent;
  for (const entry of response.data.entries) {
    const row = document.createElement("div");
    row.className = "browse-row";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "browse-name";
    name.textContent = entry.git ? `${entry.name}   git` : entry.name;
    name.addEventListener("click", () => loadBrowser(entry.path));
    row.append(name);
    if (entry.git) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open";
      open.textContent = "Open";
      open.addEventListener("click", () => openBrowsed(entry.path));
      row.append(open);
    }
    list.append(row);
  }
  if (response.data.entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "No folders here.";
    list.append(empty);
  }
}

async function openBrowsed(folder) {
  const opened = await window.jetGit.openProject({ host: state.browseHost, path: folder });
  if (!opened.ok) {
    state.error = opened.error;
    renderStatus();
    return;
  }
  document.querySelector("#browse").hidden = true;
  applySession(opened.data);
  await reload();
}

async function pickRepository() {
  const response = await window.jetGit.pickRepository();
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  if (!response.data) return;
  if (response.data.remote) {
    await openBrowser(response.data.host, response.data.label, "/");
    return;
  }
  applySession(response.data);
  await reload();
}

function moveSelection(step) {
  const rows = state.view?.rows ?? [];
  if (rows.length === 0) return;
  const index = rows.findIndex((row) => row.hash === state.selected);
  const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
  if (next) selectCommit(next.hash);
}

function tagIndex() {
  const map = new Map();
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.ref?.startsWith("refs/tags/") && node.hash) {
        const name = refLabel(node.ref);
        const list = map.get(node.hash) ?? [];
        if (!list.includes(name)) list.push(name);
        map.set(node.hash, list);
      }
      walk(node.children);
    }
  };
  walk(state.view?.branches?.tags);
  return map;
}

function refLabel(ref) {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (ref.startsWith("refs/remotes/")) return ref.slice("refs/remotes/".length);
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  return ref.slice(0, 8);
}

function closePopups() {
  suggest.hidden = true;
  menu.hidden = true;
  suggest.replaceChildren();
  menu.replaceChildren();
  menu.style.width = "";
}

function placePopup(pop, x, y) {
  pop.hidden = false;
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${y}px`;
}

function openMenu(x, y, actions) {
  closePopups();
  for (const action of actions) {
    if (action.separator) {
      const line = document.createElement("div");
      line.className = "menu-sep";
      menu.append(line);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = action.label;
    button.append(label);
    if (action.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = action.hint;
      button.append(hint);
    }
    button.addEventListener("click", () => {
      if (action.children?.length) {
        openMenu(x + 240, y, action.children);
        return;
      }
      closePopups();
      action.run();
    });
    menu.append(button);
  }
  placePopup(menu, x, y);
}

function openSuggest(anchor, entries, onPick, onExtra) {
  suggest.replaceChildren();
  menu.hidden = true;
  if (entries.length === 0) {
    suggest.hidden = true;
    return;
  }
  for (const entry of entries.slice(0, 200)) {
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = entry.label;
    button.append(label);
    if (entry.kind) {
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = entry.kind;
      button.append(kind);
    }
    if (entry.extra && onExtra) {
      const extra = document.createElement("span");
      extra.className = "action";
      extra.textContent = entry.extra;
      extra.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onExtra(entry);
      });
      button.append(extra);
    }
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      onPick(entry);
    });
    suggest.append(button);
  }
  const rect = anchor.getBoundingClientRect();
  placePopup(suggest, rect.left, rect.bottom + 4);
  suggest.style.width = `${Math.max(rect.width, 260)}px`;
}

function listedRefs() {
  const repos = state.view?.repos?.length ? state.view.repos : (state.view?.branches ? [{ root: state.root, name: "", branches: state.view.branches }] : []);
  const items = [];
  const walk = (nodes, kind, root, name) => {
    for (const node of nodes ?? []) {
      if (node.ref) items.push({ label: refLabel(node.ref), ref: node.ref, kind, root, repo: name, current: Boolean(node.current) });
      walk(node.children, kind, root, name);
    }
  };
  for (const repo of repos) {
    const panel = repo.branches;
    if (!panel) continue;
    walk(panel.local, "local", repo.root, repo.name);
    for (const remote of panel.remotes ?? []) walk(remote.children, remote.name, repo.root, repo.name);
    walk(panel.tags, "tag", repo.root, repo.name);
  }
  return items;
}

function compareSelection() {
  const hashes = sameRepoSelection();
  if (hashes.length >= 2) {
    startCompare(hashes[hashes.length - 1], hashes[0], activeRoot());
    return;
  }
  const row = rowByHash(hashes[0]);
  if (row?.parents?.[0]) startCompare(row.parents[0], row.hash, row.root);
}

function offerNeedle(input, picked) {
  const value = input.value.trim();
  if (!value || value === picked) return "";
  return value;
}

function showBranchOffers() {
  const many = (state.view?.repos?.length ?? 0) > 1;
  const checkout = [...new Set(viewedRepos().map(checkoutName).filter(Boolean))];
  const shown = state.rev ? (state.branchLabel || "") : (checkout.length === 1 ? checkout[0] : "");
  const needle = offerNeedle(branchInput, shown);
  const entries = listedRefs().filter((item) => matchesName(needle, item.label) || matchesName(needle, item.repo || "")).map((item) => ({
    ...item,
    kind: many && item.repo ? `${item.repo} · ${item.kind}` : item.kind,
    extra: "Compare",
  }));
  openSuggest(branchInput, entries, (entry) => {
    state.branchLabel = entry.label;
    showRevision(entry.root, entry.ref, entry.label);
  }, (entry) => compareBranchRef(entry.root, state.rev && (!entry.root || state.repo === entry.root) ? state.rev : "HEAD", entry.ref));
}

function showUserOffers() {
  const needle = offerNeedle(userInput, state.author);
  const entries = state.knownAuthors.filter((name) => matchesName(needle, name)).map((name) => ({ label: name }));
  openSuggest(userInput, entries, (entry) => {
    state.author = entry.label;
    userInput.value = entry.label;
    closePopups();
    reload();
  });
}

const DATE_PRESETS = [
  { label: "All" },
  { label: "Last day", days: 1 },
  { label: "Last week", days: 7 },
  { label: "Last month", days: 30 },
  { label: "Last year", days: 365 },
];

function isoDaysAgo(days) {
  const date = new Date(Date.now() - days * 86400000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function showDateOffers() {
  const needle = offerNeedle(dateInput, state.dateLabel || "");
  const entries = DATE_PRESETS.filter((item) => matchesName(needle, item.label));
  openSuggest(dateInput, entries, (entry) => {
    state.since = entry.days ? isoDaysAgo(entry.days) : "";
    state.until = "";
    state.dateLabel = entry.label === "All" ? "" : entry.label;
    dateInput.value = state.dateLabel;
    closePopups();
    state.limit = 400;
    reload();
  });
}

function applyTypedDate(value) {
  const text = value.trim();
  if (!text) {
    state.since = "";
    state.until = "";
    state.dateLabel = "";
    return true;
  }
  const parts = text.split(/\s+|\.\./).filter(Boolean);
  const date = /^\d{2}\.\d{2}\.\d{4}$/;
  if (parts.length === 1 && date.test(parts[0])) {
    state.since = parts[0];
    state.until = "";
    state.dateLabel = parts[0];
    return true;
  }
  if (parts.length === 2 && parts.every((part) => date.test(part))) {
    state.since = parts[0];
    state.until = parts[1];
    state.dateLabel = text;
    return true;
  }
  return false;
}

function applyTypedPath(value) {
  const shown = value.trim();
  const text = shown.replace(/\/$/, "");
  const repos = state.view?.repos ?? [];
  const hit = repos.find((repo) => text === repo.name || text.toLowerCase().startsWith(`${repo.name.toLowerCase()}/`));
  if (hit && text === hit.name) {
    state.repo = hit.root;
    state.repoLabel = hit.name;
    state.path = "";
  } else if (hit && repos.length > 1) {
    state.repo = hit.root;
    state.repoLabel = hit.name;
    state.path = text.slice(hit.name.length).replace(/^\//, "");
  } else {
    state.path = text;
  }
  state.pathLabel = shown;
}

let pathToken = 0;

async function showPathOffers() {
  const token = ++pathToken;
  const typed = offerNeedle(pathsInput, state.pathLabel || "");
  const repos = state.view?.repos ?? [];
  const entries = [{ label: "All paths", all: true }];
  for (const repo of repos) {
    if (typed && !matchesName(typed, repo.name) && !repo.root.toLowerCase().includes(typed.toLowerCase())) continue;
    entries.push({ label: repo.name, root: repo.root, kind: "repository", repoPick: true });
  }
  const targets = (state.repo
    ? repos.filter((repo) => repo.root === state.repo)
    : repos.filter((repo) => repos.length === 1 || (typed && typed.toLowerCase().startsWith(`${repo.name.toLowerCase()}/`)))
  ).slice(0, 6);
  for (const repo of targets) {
    let prefix = typed;
    let labelPrefix = "";
    if (!state.repo && repos.length > 1) {
      const head = `${repo.name}/`;
      labelPrefix = head;
      prefix = typed.toLowerCase().startsWith(head.toLowerCase()) ? typed.slice(head.length) : "";
    }
    const response = await window.jetGit.paths({ root: repo.root, prefix });
    if (token !== pathToken) return;
    if (!response.ok) continue;
    for (const item of response.data) {
      const label = `${labelPrefix}${item.path}`;
      if (typed && !label.toLowerCase().includes(typed.toLowerCase())) continue;
      entries.push({
        label,
        root: repo.root,
        path: item.path.replace(/\/$/, ""),
        kind: item.directory ? "folder" : "file",
      });
    }
  }
  if (token !== pathToken) return;
  openSuggest(pathsInput, entries, (entry) => {
    window.clearTimeout(pathTimer);
    if (entry.all) {
      state.path = "";
      state.pathLabel = "";
      pathsInput.value = "";
    } else if (entry.repoPick) {
      state.repo = entry.root;
      state.repoLabel = entry.label;
      state.path = "";
      state.pathLabel = entry.label;
      pathsInput.value = entry.label;
    } else {
      if (repos.length > 1) {
        state.repo = entry.root;
        state.repoLabel = repos.find((repo) => repo.root === entry.root)?.name || "";
      }
      state.path = entry.path;
      state.pathLabel = entry.label;
      pathsInput.value = entry.label;
    }
    closePopups();
    state.limit = 400;
    reload();
  });
}

function compareBranchRef(root, from, to) {
  if (!from || !to || from === to) return;
  state.repo = root || state.repo;
  startCompare(from, to, root || activeRoot());
}

function applySession(data) {
  const next = data.active ?? null;
  const changed = next !== state.projectId;
  state.hosts = data.hosts ?? state.hosts;
  state.activeHost = data.activeHost ?? "local";
  state.projects = data.projects ?? [];
  state.projectId = next;
  if (changed) {
    state.root = null;
    state.repo = null;
    state.rev = null;
    state.view = null;
    state.selected = null;
    state.detail = null;
    state.compare = null;
    state.compareBase = null;
    state.file = null;
    state.diff = null;
    state.fileDiffs = {};
    state.selection = [];
    state.anchor = null;
    state.files = [];
    state.editor = null;
    state.review = null;
    state.reviewPick = null;
    state.changes = null;
    state.workFile = null;
    state.branchFrom = null;
    state.shownRepos = null;
    state.stashes = [];
    state.shelves = [];
    state.saved = null;
    state.limit = 400;
    state.author = "";
    state.knownAuthors = [];
    state.since = "";
    state.until = "";
    state.path = "";
    state.pathLabel = "";
    state.dateLabel = "";
    state.search = "";
    state.branchLabel = "";
    state.repoLabel = "";
    branchInput.value = "";
    userInput.value = "";
    dateInput.value = "";
    pathsInput.value = "";
    searchInput.value = "";
  }
  renderPickers();
}

async function activateProject(id) {
  const response = await window.jetGit.activate(id);
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  applySession(response.data);
  await reload();
}

function showHostMenu() {
  const rect = hostPicker.getBoundingClientRect();
  const actions = state.hosts.map((host) => ({
    label: host.label,
    hint: host.id === state.activeHost ? "active" : "",
    run: async () => {
      const response = await window.jetGit.chooseHost(host.id);
      if (!response.ok) {
        state.error = response.error;
        renderStatus();
        return;
      }
      applySession({ ...response.data, active: state.projectId });
      const onHost = state.projects.filter((item) => item.host === host.id);
      const current = currentProject();
      if (current?.host === host.id) return;
      if (onHost[0]) await activateProject(onHost[0].id);
      else {
        state.projectId = null;
        state.view = null;
        render();
      }
    },
  }));
  actions.push({ separator: true });
  actions.push({
    label: "Add SSH host…",
    run: async () => {
      const name = window.prompt("SSH host");
      if (!name) return;
      const response = await window.jetGit.addHost(name);
      if (!response.ok) {
        state.error = response.error;
        renderStatus();
        return;
      }
      applySession({ ...response.data, active: null });
      state.projectId = null;
      state.view = null;
      render();
    },
  });
  openMenu(rect.left, rect.bottom + 4, actions);
}

function workspaceRows(projects) {
  const nodes = new Map();
  const ensure = (dir) => {
    let node = nodes.get(dir);
    if (node) return node;
    node = { path: dir, name: dir.slice(dir.lastIndexOf("/") + 1), project: null, children: [] };
    nodes.set(dir, node);
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (parent && nodes.has(parent) === false) ensure(parent);
    if (parent) {
      const owner = nodes.get(parent);
      if (owner && !owner.children.some((child) => child.path === dir)) owner.children.push(node);
    }
    return node;
  };
  for (const project of projects) ensure(project.path).project = project;
  const compact = (node) => {
    node.children = node.children.map(compact);
    if (!node.project && node.children.length === 1) return node.children[0];
    return node;
  };
  const roots = [...nodes.values()]
    .filter((node) => !nodes.has(node.path.slice(0, node.path.lastIndexOf("/"))))
    .map(compact)
    .sort((left, right) => left.name.localeCompare(right.name));
  const rows = [];
  const walk = (node, depth) => {
    rows.push(node.depth === undefined ? { ...node, depth } : node);
    rows[rows.length - 1] = { name: node.name, path: node.path, project: node.project, depth };
    const children = [...node.children].sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

function showProjectMenu() {
  const rect = projectPicker.getBoundingClientRect();
  closePopups();
  const projects = state.projects.filter((item) => item.host === state.activeHost);
  for (const row of workspaceRows(projects)) {
    if (!row.project) {
      const label = document.createElement("div");
      label.className = "menu-label";
      label.style.paddingLeft = `${10 + row.depth * 14}px`;
      label.textContent = row.name;
      menu.append(label);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.style.paddingLeft = `${10 + row.depth * 14}px`;
    const label = document.createElement("span");
    label.textContent = row.name;
    button.append(label);
    if (row.project.id === state.projectId) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = "active";
      button.append(hint);
    }
    button.addEventListener("click", () => {
      closePopups();
      activateProject(row.project.id);
    });
    menu.append(button);
  }
  const line = document.createElement("div");
  line.className = "menu-sep";
  menu.append(line);
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "Open workspace…";
  open.addEventListener("click", () => {
    closePopups();
    pickRepository();
  });
  menu.append(open);
  placePopup(menu, rect.left, rect.bottom + 4);
  menu.style.width = "320px";
}

function showRepoMenu() {
  const rect = repoPicker.getBoundingClientRect();
  closePopups();
  const catalog = catalogRepos();
  const filter = document.createElement("input");
  filter.className = "menu-filter";
  filter.placeholder = "Filter repositories";
  filter.spellcheck = false;
  menu.append(filter);
  const list = document.createElement("div");
  menu.append(list);
  const draw = () => {
    list.replaceChildren();
    const needle = filter.value.trim().toLowerCase();
    const visible = catalog.filter((repo) => !needle || repo.name.toLowerCase().includes(needle));
    if (catalog.length > 1 && !needle) {
      const all = document.createElement("button");
      all.type = "button";
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = state.shownRepos ? "" : "✓";
      const label = document.createElement("span");
      label.textContent = "All repositories";
      all.append(mark, label);
      all.addEventListener("click", () => {
        state.shownRepos = null;
        state.repo = null;
        reload();
        showRepoMenu();
      });
      list.append(all);
      const none = document.createElement("button");
      none.type = "button";
      const noneMark = document.createElement("span");
      noneMark.className = "mark";
      noneMark.textContent = state.shownRepos?.length === 0 ? "✓" : "";
      const noneLabel = document.createElement("span");
      noneLabel.textContent = "Deselect all";
      none.append(noneMark, noneLabel);
      none.addEventListener("click", () => {
        state.shownRepos = [];
        state.repo = null;
        reload();
        showRepoMenu();
      });
      list.append(none);
    }
    for (const repo of visible) {
      const button = document.createElement("button");
      button.type = "button";
      const mark = document.createElement("span");
      mark.className = "mark";
      const on = !state.shownRepos || state.shownRepos.includes(repo.root);
      mark.textContent = on ? "✓" : "";
      const label = document.createElement("span");
      label.textContent = repo.name;
      button.append(mark, label);
      button.addEventListener("click", () => {
        toggleShownRepo(repo.root);
        showRepoMenu();
      });
      list.append(button);
    }
  };
  filter.addEventListener("input", draw);
  filter.addEventListener("keydown", (event) => event.stopPropagation());
  draw();
  placePopup(menu, rect.left, rect.bottom + 4);
  menu.style.width = "320px";
  filter.focus();
}

function widenDetails() {
  if (state.detailsWidth >= 640) return;
  state.detailsWidth = 760;
  document.documentElement.style.setProperty("--details-width", `${state.detailsWidth}px`);
}

function appendFiles(files, selected, onPick) {
  const section = document.createElement("p");
  section.className = "section";
  section.textContent = `${files.length} ${files.length === 1 ? "file" : "files"}`;
  detail.append(section);
  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file";
    if (file.path === selected) button.classList.add("selected");
    const status = document.createElement("span");
    status.className = `status ${file.status[0] ?? ""}`;
    status.textContent = file.status[0] ?? "";
    const pathText = document.createElement("span");
    pathText.textContent = file.path;
    button.append(status, pathText);
    button.addEventListener("click", () => onPick(file.path));
    detail.append(button);
  }
}

const CODE_KEYWORDS = {
  js: new Set("async await break case catch class const continue default else export extends finally for function if import interface let new of return static super switch this throw try typeof var void while yield true false null undefined".split(" ")),
  java: new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null".split(" ")),
  py: new Set("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None".split(" ")),
  sh: new Set("if then else elif fi for while do done case esac function return exit echo local export".split(" ")),
  css: new Set(),
  json: new Set(),
  yaml: new Set(),
  md: new Set(),
  markup: new Set(),
};

function languageOf(filePath) {
  const ext = String(filePath ?? "").split(".").pop().toLowerCase();
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext)) return "js";
  if (ext === "java") return "java";
  if (ext === "py") return "py";
  if (["sh", "bash", "zsh"].includes(ext)) return "sh";
  if (["css", "scss"].includes(ext)) return "css";
  if (ext === "json") return "json";
  if (["yml", "yaml"].includes(ext)) return "yaml";
  if (["md", "markdown"].includes(ext)) return "md";
  if (["html", "xml", "vue"].includes(ext)) return "markup";
  return "text";
}

function tokenize(text, lang) {
  const keywords = CODE_KEYWORDS[lang];
  if (!keywords) return [{ kind: "plain", text }];
  const tokens = [];
  let index = 0;
  const push = (kind, value) => {
    if (value) tokens.push({ kind, text: value });
  };
  while (index < text.length) {
    if ((lang === "js" || lang === "java" || lang === "css") && text.startsWith("//", index) && lang !== "css") {
      push("comment", text.slice(index));
      break;
    }
    if (text.startsWith("/*", index) && lang !== "py" && lang !== "yaml" && lang !== "sh") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      push("comment", text.slice(index, stop));
      index = stop;
      continue;
    }
    if ((lang === "py" || lang === "yaml" || lang === "sh") && text[index] === "#") {
      push("comment", text.slice(index));
      break;
    }
    if (lang === "markup" && text[index] === "<") {
      let cursor = index + 1;
      if (text[cursor] === "/") cursor += 1;
      const start = cursor;
      while (cursor < text.length && /[A-Za-z0-9:_-]/.test(text[cursor])) cursor += 1;
      push("plain", text.slice(index, start));
      push("tag", text.slice(start, cursor));
      index = cursor;
      continue;
    }
    const quote = text[index];
    if (quote === "\"" || quote === "'" || quote === "`") {
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      push("string", text.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (/[0-9]/.test(text[index])) {
      let cursor = index + 1;
      while (cursor < text.length && /[0-9a-fxA-F._]/.test(text[cursor])) cursor += 1;
      push("number", text.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (/[A-Za-z_$]/.test(text[index])) {
      let cursor = index + 1;
      while (cursor < text.length && /[A-Za-z0-9_$]/.test(text[cursor])) cursor += 1;
      const word = text.slice(index, cursor);
      push(keywords.has(word) ? "keyword" : "plain", word);
      index = cursor;
      continue;
    }
    push("plain", text[index]);
    index += 1;
  }
  return tokens;
}

function appendTokens(target, text, filePath) {
  const lang = languageOf(filePath);
  if (!text || state.settings?.syntax === false || lang === "text") {
    target.append(document.createTextNode(text ?? ""));
    return;
  }
  for (const token of tokenize(text, lang)) {
    if (token.kind === "plain") {
      target.append(document.createTextNode(token.text));
      continue;
    }
    const span = document.createElement("span");
    span.className = `tok ${token.kind}`;
    span.textContent = token.text;
    target.append(span);
  }
}

function paintCode(code, text, filePath) {
  code.replaceChildren();
  appendTokens(code, text, filePath);
}

function splitWords(text) {
  return String(text ?? "").split(/([^\w]+)/).filter((part) => part.length > 0);
}

function wordDiff(before, after) {
  const left = splitWords(before);
  const right = splitWords(after);
  if (left.length * right.length > 8000) return null;
  const width = right.length + 1;
  const dp = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const at = i * width + j;
      dp[at] = left[i] === right[j] ? dp[at + width + 1] + 1 : Math.max(dp[at + width], dp[at + 1]);
    }
  }
  const leftParts = [];
  const rightParts = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      leftParts.push({ text: left[i], changed: false });
      rightParts.push({ text: right[j], changed: false });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      leftParts.push({ text: left[i], changed: true });
      i += 1;
    } else {
      rightParts.push({ text: right[j], changed: true });
      j += 1;
    }
  }
  while (i < left.length) leftParts.push({ text: left[i], changed: true }), i += 1;
  while (j < right.length) rightParts.push({ text: right[j], changed: true }), j += 1;
  return { left: leftParts, right: rightParts };
}

function paintWords(code, parts, filePath, inlClass) {
  code.replaceChildren();
  const merged = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.changed === part.changed) last.text += part.text;
    else merged.push({ ...part });
  }
  for (const part of merged) {
    if (!part.changed) {
      appendTokens(code, part.text, filePath);
      continue;
    }
    const span = document.createElement("span");
    span.className = inlClass;
    appendTokens(span, part.text, filePath);
    code.append(span);
  }
}

function sideCell(kind, number, text, filePath, words, inlClass) {
  const cell = document.createElement("div");
  cell.className = `cell ${kind}`.trim();
  const no = document.createElement("span");
  no.className = "no";
  no.textContent = number ? String(number) : "";
  const code = document.createElement("span");
  code.className = "code";
  if (words) paintWords(code, words, filePath, inlClass);
  else paintCode(code, text ?? "", filePath);
  cell.append(no, code);
  return cell;
}

function seamCell(kind) {
  const seam = document.createElement("div");
  seam.className = "seam";
  if (kind) {
    const chevron = document.createElement("span");
    chevron.className = `chevron ${kind}`;
    seam.append(chevron);
  }
  return seam;
}

function paneLine(cell, marker, diffId, side, lineNo) {
  const line = document.createElement("div");
  line.className = "diff-line";
  if (diffId) line.dataset.diff = String(diffId);
  if (side && lineNo) {
    line.dataset.side = side;
    line.dataset.line = String(lineNo);
  }
  line.append(cell);
  if (marker) {
    const chevron = document.createElement("span");
    chevron.className = `chevron ${marker}`;
    line.append(chevron);
  }
  return line;
}

function mountDiffPanes(view, leftLines, rightLines) {
  const left = document.createElement("div");
  const right = document.createElement("div");
  left.className = "diff-pane";
  right.className = "diff-pane";
  left.append(...leftLines);
  right.append(...rightLines);
  const split = document.createElement("div");
  split.className = "diff-split";
  const ratio = state.diffSplit ?? 50;
  view.className = "diff-view panes";
  view.style.gridTemplateColumns = `${ratio}fr 6px ${100 - ratio}fr`;
  view.append(left, split, right);
  let lock = false;
  const sync = (from, to) => {
    if (lock || to.scrollTop === from.scrollTop) return;
    lock = true;
    to.scrollTop = from.scrollTop;
    lock = false;
  };
  left.addEventListener("scroll", () => sync(left, right));
  right.addEventListener("scroll", () => sync(right, left));
  split.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const bounds = view.getBoundingClientRect();
    const move = (pointer) => {
      const next = Math.min(78, Math.max(22, ((pointer.clientX - bounds.left) / bounds.width) * 100));
      state.diffSplit = next;
      view.style.gridTemplateColumns = `${next}fr 6px ${100 - next}fr`;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  });
}

function wholeFile(diff) {
  if (diff.single) return true;
  const rows = diff.rows ?? [];
  return rows.length > 0 && rows.every((row) => row.kind === "hunk" || row.kind === "add");
}

function renderDiffTable(diff) {
  const view = document.createElement("div");
  const single = wholeFile(diff);
  view.className = single ? "diff-view single" : "diff-view";
  if (diff.binary) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = diff.size ? `Binary file (${diff.size} bytes).` : "Binary file.";
    view.append(note);
    return view;
  }
  if (diff.missing) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "File was removed from the worktree.";
    view.append(note);
    return view;
  }
  if (!diff.rows?.length) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = diff.truncated ? "Diff truncated." : (single ? "Empty file." : "No textual changes.");
    view.append(note);
    return view;
  }
  const filePath = state.editor?.path ?? "";
  let previous = "context";
  let differences = 0;
  const leftLines = [];
  const rightLines = [];
  for (const row of diff.rows) {
    if (row.kind === "hunk") continue;
    const changed = row.kind !== "context";
    const start = changed && previous === "context";
    if (start) differences += 1;
    previous = changed ? "change" : "context";
    if (single && row.kind === "add") {
      view.append(paneLine(sideCell("add", row.right, row.text, filePath), "", start ? differences : 0, "new", row.right));
      continue;
    }
    const marker = start ? (row.kind === "del" ? "del" : "add") : "";
    const diffId = start ? differences : 0;
    if (row.kind === "context") {
      leftLines.push(paneLine(sideCell("", row.left, row.text, filePath), "", 0, "old", row.left));
      rightLines.push(paneLine(sideCell("", row.right, row.text, filePath), "", 0, "new", row.right));
    } else if (row.kind === "del") {
      leftLines.push(paneLine(sideCell("del", row.left, row.text, filePath), marker, diffId, "old", row.left));
      rightLines.push(paneLine(sideCell("empty", null, "", filePath)));
    } else if (row.kind === "add") {
      leftLines.push(paneLine(sideCell("empty", null, "", filePath), marker, diffId));
      rightLines.push(paneLine(sideCell("add", row.right, row.text, filePath), "", 0, "new", row.right));
    } else if (row.kind === "change") {
      const words = wordDiff(row.before, row.after);
      leftLines.push(paneLine(sideCell("mod-del", row.left, row.before, filePath, words?.left, "inl del"), marker, diffId, "old", row.left));
      rightLines.push(paneLine(sideCell("mod-add", row.right, row.after, filePath, words?.right, "inl add"), "", 0, "new", row.right));
    }
  }
  if (!single) mountDiffPanes(view, leftLines, rightLines);
  view.dataset.differences = String(differences);
  if (diff.truncated) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Diff truncated.";
    view.append(note);
  }
  return view;
}

function renderCompare(compared) {
  const title = document.createElement("h1");
  title.className = "commit-title";
  title.textContent = `${compared.from.slice(0, 8)} → ${compared.to.slice(0, 8)}`;
  detail.append(title);
  appendFiles(compared.files, state.file, selectCompareFile);
  if (state.diff) detail.append(renderDiffTable(state.diff));
  else if (compared.files.length === 0) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No changes between these commits.";
    detail.append(empty);
  }
}

function showEditor(filePath, status, kind) {
  const token = ++editorToken;
  state.editor = { path: filePath, status, diff: null, token, kind };
  renderEditor();
  return token;
}

function closeEditor() {
  editorToken += 1;
  state.editor = null;
  renderEditor();
  renderDetail();
}

function editorFileList() {
  if (state.editor?.kind === "work") return state.changes?.files ?? [];
  if (state.editor?.kind === "stash" || state.editor?.kind === "shelf") return state.saved?.files ?? [];
  if (state.compare) return state.compare.files ?? [];
  return state.files ?? [];
}

function renderEditor() {
  const open = Boolean(state.editor);
  editorPane.hidden = !open;
  editorSplitter.hidden = !open;
  workspace.classList.toggle("split", open);
  if (!open) return;
  const filePath = state.editor.path;
  editorTitle.textContent = filePath.split("/").pop();
  editorTitle.className = statusClass(state.editor.status);
  editorPath.textContent = filePath;
  const files = editorFileList();
  const index = files.findIndex((file) => file.path === filePath);
  diffFilePos.textContent = files.length ? `${Math.max(index, 0) + 1}/${files.length} files` : "";
  diffPrevFile.disabled = index <= 0;
  diffNextFile.disabled = index < 0 || index >= files.length - 1;
  editorBody.replaceChildren();
  diffPrev.disabled = true;
  diffNext.disabled = true;
  if (!state.editor.diff) {
    diffCount.textContent = "";
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Loading…";
    editorBody.append(note);
    return;
  }
  const table = renderDiffTable(state.editor.diff);
  const count = Number(table.dataset.differences || 0);
  diffCount.textContent = count === 1 ? "1 difference" : `${count} differences`;
  diffPrev.disabled = count === 0;
  diffNext.disabled = count === 0;
  editorBody.append(table);
  paintReview();
  const first = editorBody.querySelector(".diff-pane [data-diff], .diff-view.single [data-diff]");
  first?.scrollIntoView({ block: "center" });
  const panes = editorBody.querySelectorAll(".diff-pane");
  if (panes[0] && panes[1]) panes[1].scrollTop = panes[0].scrollTop;
  void ensureReview();
}

function reviewedRepo() {
  const repos = state.view?.repos ?? [];
  return repos.find((repo) => repo.root === activeRoot()) ?? repos[0] ?? null;
}

function reviewedBranch() {
  const head = reviewedRepo()?.head;
  if (!head || head.detached) return "";
  return head.name || "";
}

function reviewAnchor() {
  if (state.editor?.kind === "compare" && state.compare?.to) return state.compare.to;
  if (state.editor?.kind === "selection" && state.selected) return state.selected;
  return reviewedRepo()?.head?.hash || "";
}

function reviewDocument() {
  return {
    format: "jet-git-review",
    version: 1,
    branch: state.review?.branch || reviewedBranch(),
    head: state.review?.head || reviewAnchor(),
    comments: state.review?.comments ?? [],
  };
}

function orderedSpan(start, end) {
  return start <= end ? [start, end] : [end, start];
}

function chooseReviewLine(side, line, extend) {
  const path = state.editor?.path;
  if (!path || !side || !line) return;
  const same = state.reviewPick && state.reviewPick.path === path && state.reviewPick.side === side;
  if (extend && same) {
    const [start, end] = orderedSpan(state.reviewPick.start, line);
    state.reviewPick = { path, side, start, end };
  } else {
    state.reviewPick = { path, side, start: line, end: line };
  }
  paintReview();
}

function paintReview() {
  const view = editorBody.querySelector(".diff-view");
  if (!view || !state.editor) return;
  view.querySelectorAll(".review-note, .review-box").forEach((node) => node.remove());
  const path = state.editor.path;
  const pick = state.reviewPick?.path === path ? state.reviewPick : null;
  const [start, end] = pick ? orderedSpan(pick.start, pick.end) : [0, 0];
  for (const line of view.querySelectorAll(".diff-line")) {
    const number = Number(line.dataset.line || 0);
    line.classList.toggle("review-selected", Boolean(pick) && line.dataset.side === pick.side && number >= start && number <= end);
  }
  const place = (side, lineNo) => [...view.querySelectorAll(`.diff-line[data-side="${side}"]`)]
    .find((line) => Number(line.dataset.line) === lineNo);
  for (const comment of (state.review?.comments ?? []).filter((item) => item.path === path)) {
    const anchor = place(comment.side, comment.end);
    if (!anchor) continue;
    const note = document.createElement("div");
    note.className = "review-note";
    const text = document.createElement("div");
    const where = comment.start === comment.end ? `Line ${comment.start}` : `Lines ${comment.start}-${comment.end}`;
    text.textContent = `${where}  ${comment.body}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "clear";
    remove.setAttribute("aria-label", "Remove comment");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.review.comments = state.review.comments.filter((item) => item.id !== comment.id);
      state.review.dirty = true;
      paintReview();
    });
    note.append(text, remove);
    anchor.after(note);
  }
  if (!pick) return;
  const anchor = place(pick.side, end);
  if (!anchor) return;
  const box = document.createElement("form");
  box.className = "review-box";
  const label = document.createElement("div");
  label.className = "review-label";
  label.textContent = start === end ? `Comment on line ${start}` : `Comment on lines ${start}-${end}`;
  const area = document.createElement("textarea");
  area.placeholder = "Review comment";
  const actions = document.createElement("div");
  actions.className = "row";
  const add = document.createElement("button");
  add.type = "submit";
  add.className = "open";
  add.textContent = "Add comment";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "open";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    state.reviewPick = null;
    paintReview();
  });
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = area.value.trim();
    if (!body) return;
    if (!state.review) {
      state.review = { root: activeRoot(), branch: reviewedBranch(), head: reviewAnchor(), comments: [], dirty: true };
    }
    state.review.comments.push({
      id: crypto.randomUUID(),
      path,
      side: pick.side,
      start,
      end,
      body,
      createdAt: new Date().toISOString(),
    });
    state.review.dirty = true;
    state.review.head = reviewAnchor();
    state.review.branch = reviewedBranch() || state.review.branch;
    state.reviewPick = null;
    paintReview();
  });
  actions.append(add, cancel);
  box.append(label, area, actions);
  anchor.after(box);
  area.focus();
}

async function ensureReview() {
  const branch = reviewedBranch();
  const root = activeRoot();
  if (!branch || !root || !state.editor) return;
  if (state.review?.root === root && state.review?.branch === branch) return;
  if (state.review?.dirty) return;
  const response = await window.jetGit.reviewLoad({ root });
  if (!state.editor || reviewedBranch() !== branch) return;
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.review = {
    root,
    branch,
    head: response.data?.head || reviewAnchor(),
    comments: response.data?.comments ?? [],
    dirty: false,
  };
  if (document.activeElement?.closest?.(".review-box")) return;
  paintReview();
}

async function commitRevision() {
  const root = activeRoot();
  const review = reviewDocument();
  if (!root || !review.branch || !review.head) {
    state.error = "Review works on the current branch.";
    renderStatus();
    return;
  }
  const response = await window.jetGit.reviewCommit({ root, review });
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  if (state.review) state.review.dirty = false;
  state.notice = `Committed ${response.data.revisionBranch}`;
  state.error = null;
  renderStatus();
}

async function exportRevision() {
  const response = await window.jetGit.reviewExport({ review: reviewDocument() });
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  if (response.data?.canceled) return;
  state.notice = "Review exported";
  state.error = null;
  renderStatus();
}

function stepEditorFile(delta) {
  const files = editorFileList();
  const index = files.findIndex((file) => file.path === state.editor?.path);
  const next = files[index + delta];
  if (!next || !state.editor) return;
  if (state.editor.kind === "work") openWorkingFile(next.path);
  else if (state.editor.kind === "stash" || state.editor.kind === "shelf") openSavedFile(next.path);
  else if (state.compare) openCompareFile(next.path);
  else openSelectionFile(next.path);
}

function stepDifference(delta) {
  const marks = [...editorBody.querySelectorAll(".diff-pane:first-child [data-diff], .diff-view.single [data-diff]")];
  if (marks.length === 0) return;
  const current = marks.findIndex((mark) => mark.classList.contains("current-diff"));
  const next = current < 0 ? (delta > 0 ? 0 : marks.length - 1) : (current + delta + marks.length) % marks.length;
  marks.forEach((mark) => mark.classList.remove("current-diff"));
  marks[next].classList.add("current-diff");
  marks[next].scrollIntoView({ block: "center" });
  const panes = editorBody.querySelectorAll(".diff-pane");
  if (panes[0] && panes[1]) panes[1].scrollTop = panes[0].scrollTop;
}

function applyEditorDiff(token, response) {
  if (state.editor?.token !== token) return;
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.error = null;
  state.editor.diff = response.data;
  renderEditor();
  renderStatus();
}

async function openSelectionFile(file) {
  const known = (state.files ?? []).find((item) => item.path === file);
  const token = showEditor(file, known?.status ?? "M", "selection");
  renderDetail();
  const cached = state.fileDiffs?.[file];
  if (cached) {
    applyEditorDiff(token, { ok: true, data: cached });
    return;
  }
  const response = await window.jetGit.selectionDiff({
    root: state.root,
    hashes: orderedSelection(),
    file,
  });
  applyEditorDiff(token, response);
}

async function openCompareFile(file) {
  const known = state.compare?.files.find((item) => item.path === file);
  const token = showEditor(file, known?.status ?? "M", "compare");
  renderDetail();
  const cached = state.compare?.diffs?.[file];
  if (cached) {
    applyEditorDiff(token, { ok: true, data: cached });
    return;
  }
  const response = await window.jetGit.compareFile({
    root: state.root,
    from: state.compare.from,
    to: state.compare.to,
    file,
  });
  applyEditorDiff(token, response);
}

async function openWorkingFile(file) {
  const known = state.changes?.files.find((item) => item.path === file);
  state.workFile = file;
  const token = showEditor(file, known?.status ?? "M", "work");
  renderChanges();
  const response = await window.jetGit.workingDiff({ root: state.root, file });
  applyEditorDiff(token, response);
}

function openTreeFile(file) {
  if (!file) return;
  if (state.compare) openCompareFile(file.path);
  else openSelectionFile(file.path);
}

function fileUnmerged(file) {
  return UNMERGED.has(`${file.index}${file.worktree}`);
}

function renderConflict(changes) {
  const conflict = changes?.conflict;
  const active = Boolean(conflict?.kind);
  conflictBar.hidden = !active;
  if (!active) return;
  const count = conflict.files.length;
  conflictLabel.textContent = count
    ? `${conflict.kind} · ${count} conflicted`
    : `${conflict.kind} in progress`;
}

function changeActions(file) {
  const actions = [
    {
      label: "Discard",
      run: () => {
        if (!window.confirm(`Discard changes in ${file.path}?`)) return;
        gitAction({ action: "discard", file: file.path }, "Discarded");
      },
    },
  ];
  if (fileUnmerged(file)) {
    actions.unshift(
      { label: "Use ours", run: () => gitAction({ action: "resolve", file: file.path, side: "ours" }, "Resolved") },
      { label: "Use theirs", run: () => gitAction({ action: "resolve", file: file.path, side: "theirs" }, "Resolved") },
    );
  }
  return actions;
}

function renderChanges() {
  const changes = state.changes;
  changesList.replaceChildren();
  renderConflict(changes);
  if (!changes) {
    changesBranch.textContent = "";
    changesSync.textContent = "";
  } else {
    changesBranch.textContent = changes.detached ? "detached" : (changes.branch ?? "");
    const bits = [changes.upstream || "no upstream"];
    if (changes.ahead) bits.push(`ahead ${changes.ahead}`);
    if (changes.behind) bits.push(`behind ${changes.behind}`);
    changesSync.textContent = bits.join(" · ");
    if (changes.files.length === 0) {
      const empty = document.createElement("p");
      empty.className = "meta";
      empty.textContent = "No local changes.";
      changesList.append(empty);
    }
    for (const file of changes.files) {
      const row = document.createElement("div");
      row.className = "change";
      if (file.path === state.workFile) row.classList.add("selected");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = file.staged;
      box.addEventListener("click", (event) => event.stopPropagation());
      box.addEventListener("change", () => stageFile(file.path, box.checked));
      const button = document.createElement("button");
      button.type = "button";
      const mark = document.createElement("span");
      mark.className = `status ${statusClass(file.status)}`;
      mark.textContent = file.status === "?" ? "A" : file.status[0];
      const pathText = document.createElement("span");
      pathText.className = `path ${statusClass(file.status)}`;
      pathText.textContent = file.path;
      button.append(mark, pathText);
      button.addEventListener("click", () => openWorkingFile(file.path));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY, changeActions(file));
      });
      row.append(box, button);
      changesList.append(row);
    }
  }
  const from = state.branchFrom;
  branchFromLabel.hidden = !from;
  branchFromClear.hidden = !from;
  branchFromLabel.textContent = from ? `from ${refLabel(from)}` : "";
  renderSaved();
}

function savedButton(label, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "saved-do";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    run();
  });
  return button;
}

function renderSavedRows(title, rows, kind) {
  const head = document.createElement("div");
  head.className = "group";
  head.textContent = title;
  changesList.append(head);
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "None";
    changesList.append(empty);
    return;
  }
  for (const row of rows) {
    const id = kind === "stash" ? row.id : row.name;
    const line = document.createElement("div");
    line.className = "change";
    if (state.saved?.kind === kind && state.saved?.id === id) line.classList.add("selected");
    const button = document.createElement("button");
    button.type = "button";
    const pathText = document.createElement("span");
    pathText.className = "path";
    pathText.textContent = kind === "stash" ? row.subject : row.name;
    button.append(pathText);
    button.addEventListener("click", () => openSaved(kind, id));
    line.append(button);
    line.append(savedButton("Apply", () => applySaved(kind, id, false)));
    if (kind === "stash") line.append(savedButton("Pop", () => applySaved(kind, id, true)));
    line.append(savedButton("Drop", () => dropSaved(kind, id)));
    changesList.append(line);
  }
}

function renderSaved() {
  renderSavedRows("Stash", state.stashes ?? [], "stash");
  renderSavedRows("Shelf", state.shelves ?? [], "shelf");
}

async function openSaved(kind, id) {
  const root = state.root;
  if (!root) return;
  const token = showEditor(id, "M", kind);
  const response = await window.jetGit.savedPatch({ root, kind, id });
  if (state.editor?.token !== token) return;
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.saved = { kind, id, root, files: response.data.files ?? [] };
  state.editor.path = response.data.path || id;
  state.editor.diff = response.data;
  renderEditor();
  renderChanges();
}

async function openSavedFile(file) {
  const saved = state.saved;
  if (!saved) return;
  const known = saved.files.find((item) => item.path === file);
  const token = showEditor(file, known?.status ?? "M", saved.kind);
  const response = await window.jetGit.savedPatch({ root: saved.root, kind: saved.kind, id: saved.id, file });
  applyEditorDiff(token, response);
}

async function applySaved(kind, id, remove) {
  await runRepoAction(async () => {
    const response = await window.jetGit.savedApply({ root: state.root, kind, id, remove });
    if (!response.ok) {
      state.error = response.error;
      state.tab = "git";
      render();
      await loadWorktree();
      return;
    }
    await finishNotice(remove ? (kind === "stash" ? "Stash popped" : "Shelf removed") : "Patch applied");
  });
}

async function dropSaved(kind, id) {
  const label = kind === "stash" ? `Drop ${id}?` : `Drop shelf ${id}?`;
  if (!window.confirm(label)) return;
  await runRepoAction(async () => {
    const response = await window.jetGit.savedDrop({ root: state.root, kind, id });
    if (!response.ok) {
      state.error = response.error;
      renderStatus();
      return;
    }
    if (state.saved?.kind === kind && state.saved?.id === id) closeEditor();
    await finishNotice(kind === "stash" ? "Stash dropped" : "Shelf dropped");
  });
}

async function loadWorktree() {
  if (!state.root) {
    state.changes = null;
    state.stashes = [];
    state.shelves = [];
    renderChanges();
    return;
  }
  const root = state.root;
  const [response, saved] = await Promise.all([
    window.jetGit.changes({ root }),
    window.jetGit.saved({ root }),
  ]);
  if (state.root !== root) return;
  if (saved.ok) {
    state.stashes = saved.data.stashes ?? [];
    state.shelves = saved.data.shelves ?? [];
  }
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.changes = response.data;
  if (state.workFile && !response.data.files.some((file) => file.path === state.workFile)) state.workFile = null;
  if (state.editor?.kind === "work" && !response.data.files.some((file) => file.path === state.editor.path)) closeEditor();
  renderChanges();
}

async function stageFile(file, staged) {
  const response = await window.jetGit.stage({ root: state.root, file, staged });
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    await loadWorktree();
    return;
  }
  state.changes = response.data;
  renderChanges();
}

async function runRepoAction(work) {
  if (actionBusy || !state.root) return;
  actionBusy = true;
  state.error = null;
  try {
    await work();
  } finally {
    actionBusy = false;
  }
}

async function finishNotice(label) {
  await reload();
  state.notice = label;
  renderStatus();
}

async function gitAction(payload, label) {
  await runRepoAction(async () => {
    const response = await window.jetGit.action({ root: state.root, ...payload });
    if (!response.ok) {
      state.error = response.error;
      if (response.code === "CONFLICT") {
        state.tab = "git";
        render();
        await loadWorktree();
      } else renderStatus();
      return;
    }
    if (response.data?.canceled) return;
    await finishNotice(label);
  });
}

let finishAsk = null;

function askText(title, initial) {
  if (finishAsk) finishAsk(null);
  const pane = document.querySelector("#ask");
  const text = document.querySelector("#ask-text");
  document.querySelector("#ask-title").textContent = title;
  text.value = initial;
  pane.hidden = false;
  text.focus();
  return new Promise((resolve) => {
    finishAsk = (value) => {
      finishAsk = null;
      pane.hidden = true;
      resolve(value);
    };
  });
}

function squashDraft(hashes) {
  return hashes.slice().reverse().map((hash) => {
    const row = rowByHash(hash);
    if (!row) return hash.slice(0, 8);
    return [row.subject, row.body].filter(Boolean).join("\n\n");
  }).filter(Boolean).join("\n\n");
}

function useBranchStart(start) {
  state.branchFrom = start;
  state.tab = "git";
  closePopups();
  render();
  renderChanges();
  newBranchInput.focus();
}

async function checkout(rev, root = activeRoot()) {
  closePopups();
  if (root) state.root = root;
  const response = await window.jetGit.checkout({ root: state.root, rev });
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.error = null;
  state.rev = null;
  branchInput.value = "";
  state.compare = null;
  await reload();
}

async function startCompare(from, to, root = activeRoot()) {
  closePopups();
  if (!from || !to || from === to) return;
  if (root) state.root = root;
  const response = await window.jetGit.compare({ root: state.root, from, to });
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.error = null;
  state.compare = response.data;
  state.file = null;
  state.diff = null;
  state.selected = response.data.to;
  closeEditor();
  renderLog();
}

async function selectCompareFile(file) {
  const compared = state.compare;
  if (!compared) return;
  state.file = file;
  state.diff = null;
  renderDetail();
  const response = await window.jetGit.compareFile({
    root: state.root,
    from: compared.from,
    to: compared.to,
    file,
  });
  if (state.file !== file || !state.compare) return;
  if (!response.ok) {
    state.error = response.error;
    renderStatus();
    return;
  }
  state.diff = response.data;
  widenDetails();
  renderDetail();
}

function commitActions(row) {
  const root = row.root || activeRoot();
  const selected = sameRepoSelection();
  const hashes = selected.includes(row.hash) ? selected : [row.hash];
  const parents = row.parents ?? [];
  const children = (state.view?.rows ?? []).filter((item) => item.root === root && (item.parents ?? []).includes(row.hash));
  const go = (hash) => {
    if (rowByHash(hash)) selectCommit(hash);
    else showRevision(root, hash, hash.slice(0, 8));
  };
  const actions = [
    { label: "Copy revision number", hint: "⌥⌘C", run: () => window.jetGit.copyText(row.hash) },
    { label: "Create patch…", run: () => gitAction({ action: "create-patch", root, hashes }, "Patch saved") },
    { label: "Cherry-pick", run: () => gitAction({ action: "cherry-pick", root, hash: row.hash }, "Cherry-picked") },
    { separator: true },
    { label: "Show repository at revision", run: () => showRevision(root, row.hash, row.hash.slice(0, 8)) },
    { label: "Compare versions", run: () => compareSelection() },
    { separator: true },
    {
      label: "Reset current branch to here…",
      run: () => {
        const mode = window.prompt("Reset mode: soft, mixed or hard", "mixed");
        if (!mode) return;
        if (mode === "hard" && !window.confirm("Hard reset discards local changes in this repository.")) return;
        gitAction({ action: "reset", root, hash: row.hash, mode }, "Reset");
      },
    },
    { label: "Revert commits", run: () => gitAction({ action: "revert", root, hashes }, "Reverted") },
    {
      label: "Drop commits",
      run: () => {
        if (!window.confirm("Drop the selected commits from this branch?")) return;
        gitAction({ action: "drop", root, hashes }, "Dropped");
      },
    },
  ];
  if (hashes.length >= 2) {
    actions.push({
      label: "Squash commits…",
      run: async () => {
        closePopups();
        const message = await askText("Squash commits", squashDraft(hashes));
        if (!message || !message.trim()) return;
        gitAction({ action: "squash", root, hashes, message }, "Squashed");
      },
    });
  }
  actions.push(
    {
      label: "Push all up to here…",
      run: () => {
        if (!window.confirm("Push the current branch up to this commit?")) return;
        gitAction({ action: "push-up-to", root, hash: row.hash }, "Pushed");
      },
    },
    { separator: true },
    { label: "New branch…", run: () => { state.root = root; useBranchStart(row.hash); } },
    {
      label: "New tag…",
      run: () => {
        const name = window.prompt("Tag name");
        if (!name) return;
        gitAction({ action: "create-tag", root, name, hash: row.hash }, `Tag ${name}`);
      },
    },
    { separator: true },
  );
  if (children.length === 1) actions.push({ label: "Go to child commit", run: () => go(children[0].hash) });
  else if (children.length > 1) {
    actions.push({ label: "Go to child commit", children: children.map((item) => ({ label: item.subject, run: () => go(item.hash) })) });
  }
  if (parents.length === 1) actions.push({ label: "Go to parent commit", run: () => go(parents[0]) });
  else if (parents.length > 1) {
    actions.push({ label: "Go to parent commit", children: parents.map((hash) => ({ label: hash.slice(0, 8), run: () => go(hash) })) });
  }
  return actions;
}

function branchActions(node) {
  const local = node.ref.startsWith("refs/heads/");
  const tag = node.ref.startsWith("refs/tags/");
  const actions = [
    { label: local ? "Checkout" : "Checkout detached", run: () => checkout(node.ref, node.root) },
    {
      label: "Show in log",
      run: () => showRevision(node.root, node.ref, refLabel(node.ref)),
    },
    { label: "Copy name", run: () => window.jetGit.copyText(refLabel(node.ref)) },
    { label: "Compare with current", run: () => compareBranchRef(node.root, "HEAD", node.ref) },
    ...(state.rev && state.rev !== node.ref ? [{ label: `Compare with ${branchInput.value || "filter"}`, run: () => compareBranchRef(node.root, state.rev, node.ref) }] : []),
    { label: "New branch from this", run: () => { if (node.root) state.root = node.root; useBranchStart(node.ref); } },
  ];
  if (!node.current) {
    actions.push(
      { label: "Merge into current", run: () => gitAction({ action: "merge", root: node.root, ref: node.ref }, "Merged") },
      { label: "Rebase current onto this", run: () => gitAction({ action: "rebase", root: node.root, upstream: node.ref }, "Rebased") },
    );
  }
  if (local && !node.current) {
    actions.push({
      label: "Delete branch",
      run: () => {
        if (!window.confirm(`Delete branch ${node.label}?`)) return;
        gitAction({ action: "delete-branch", root: node.root, ref: node.ref }, "Branch deleted");
      },
    });
  }
  if (tag) {
    actions.push({
      label: "Delete tag",
      run: () => {
        if (!window.confirm(`Delete tag ${node.label}?`)) return;
        gitAction({ action: "delete-tag", root: node.root, name: node.ref }, "Tag deleted");
      },
    });
  }
  return actions;
}

const settingsPane = document.querySelector("#settings");

function applySettings(data) {
  state.settings = data.appearance ?? state.settings;
  state.systemDark = data.dark !== false;
  const theme = state.settings.theme;
  const dark = theme === "dark" || (theme === "system" && state.systemDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.translucent = state.settings.translucent ? "1" : "0";
  document.documentElement.style.fontSize = `${state.settings.fontSize || 12}px`;
  if (state.editor) renderEditor();
}

function readSettingsForm() {
  return {
    theme: document.querySelector("#setting-theme").value,
    translucent: document.querySelector("#setting-translucent").checked,
    fontSize: Number(document.querySelector("#setting-font").value),
    syntax: document.querySelector("#setting-syntax").checked,
  };
}

function openSettings() {
  const appearance = state.settings ?? {};
  document.querySelector("#setting-theme").value = appearance.theme ?? "dark";
  document.querySelector("#setting-translucent").checked = appearance.translucent === true;
  document.querySelector("#setting-font").value = String(appearance.fontSize ?? 12);
  document.querySelector("#setting-syntax").checked = appearance.syntax !== false;
  settingsPane.hidden = false;
}

function closeSettings() {
  settingsPane.hidden = true;
}

async function persistSettings() {
  const response = await window.jetGit.saveSettings({ appearance: readSettingsForm() });
  if (response.ok) applySettings(response.data);
}

document.querySelector("#open").addEventListener("click", pickRepository);
document.querySelector("#ask-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (finishAsk) finishAsk(document.querySelector("#ask-text").value);
});
document.querySelector("#ask-close").addEventListener("click", () => finishAsk?.(null));
document.querySelector("#ask-cancel").addEventListener("click", () => finishAsk?.(null));
document.querySelector("#browse-close").addEventListener("click", () => {
  document.querySelector("#browse").hidden = true;
});
document.querySelector("#browse-up").addEventListener("click", () => {
  if (state.browseParent) loadBrowser(state.browseParent);
});
document.querySelector("#browse-open").addEventListener("click", () => {
  if (state.browsePath) openBrowsed(state.browsePath);
});
hostPicker.addEventListener("click", showHostMenu);
projectPicker.addEventListener("click", showProjectMenu);
repoPicker.addEventListener("click", showRepoMenu);
document.addEventListener("mousedown", (event) => {
  if (suggest.contains(event.target) || menu.contains(event.target)) return;
  if (event.target === branchInput || event.target === userInput || event.target === dateInput || event.target === pathsInput || event.target === hostPicker || event.target === projectPicker || event.target === repoPicker || hostPicker.contains(event.target) || projectPicker.contains(event.target) || repoPicker.contains(event.target)) return;
  closePopups();
});
document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const command = event.metaKey || event.ctrlKey;
  const dialogOpen = finishAsk || !document.querySelector("#browse").hidden || !settingsPane.hidden;
  if (!dialogOpen && command && event.shiftKey && !event.altKey && key === "a") {
    event.preventDefault();
    onceShortcut("actions", openActions);
    return;
  }
  if (!actionsPane.hidden && (event.target === actionQuery || event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter")) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = visibleActions().length;
      if (count === 0) return;
      actionIndex = event.key === "ArrowDown" ? (actionIndex + 1) % count : (actionIndex - 1 + count) % count;
      renderActionList();
      return;
    }
    if (event.key === "Enter" && event.target === actionQuery) {
      event.preventDefault();
      const action = visibleActions()[actionIndex];
      if (action) pickAction(action);
      return;
    }
  }
  if (!dialogOpen && command && !event.altKey && key === "k") {
    event.preventDefault();
    closeActions();
    onceShortcut(event.shiftKey ? "push" : "commit", event.shiftKey ? pushActive : commitShortcut);
    return;
  }
  if (!dialogOpen && command && !event.shiftKey && !event.altKey && key === "t") {
    event.preventDefault();
    closeActions();
    onceShortcut("update", pullActive);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === ",") {
    event.preventDefault();
    openSettings();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "c") {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (!typing && state.selected) {
      event.preventDefault();
      window.jetGit.copyText(state.selected);
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (typing) return;
    event.preventDefault();
    compareSelection();
    return;
  }
  if (event.key !== "Escape") return;
  if (!actionsPane.hidden) {
    closeActions();
    return;
  }
  if (finishAsk) {
    finishAsk(null);
    return;
  }
  if (!document.querySelector("#browse").hidden) {
    document.querySelector("#browse").hidden = true;
    return;
  }
  if (!settingsPane.hidden) {
    closeSettings();
    return;
  }
  if (!menu.hidden || !suggest.hidden) closePopups();
  else if (state.editor) closeEditor();
});
branchClear.addEventListener("click", () => {
  state.rev = null;
  state.branchLabel = "";
  state.branchQuery = "";
  branchInput.value = "";
  reload();
});
branchInput.addEventListener("focus", showBranchOffers);
branchInput.addEventListener("click", showBranchOffers);
branchInput.addEventListener("blur", () => renderScope());
branchInput.addEventListener("input", () => {
  state.branchQuery = branchInput.value;
  renderBranches();
  showBranchOffers();
});
userInput.addEventListener("focus", showUserOffers);
userInput.addEventListener("click", showUserOffers);
userInput.addEventListener("input", showUserOffers);
pathsInput.addEventListener("focus", showPathOffers);
pathsInput.addEventListener("click", showPathOffers);
dateInput.addEventListener("focus", showDateOffers);
dateInput.addEventListener("click", showDateOffers);
searchInput.addEventListener("input", debounce(() => {
  state.search = searchInput.value.trim();
  state.limit = 400;
  reload();
}, 200));
let pathTimer = 0;
let dateTimer = 0;
pathsInput.addEventListener("input", () => {
  window.clearTimeout(pathTimer);
  showPathOffers();
  pathTimer = window.setTimeout(() => {
    applyTypedPath(pathsInput.value);
    state.limit = 400;
    reload();
  }, 250);
});
pathsClear.addEventListener("click", () => {
  window.clearTimeout(pathTimer);
  state.path = "";
  state.pathLabel = "";
  pathsInput.value = "";
  state.limit = 400;
  reload();
});
dateInput.addEventListener("input", () => {
  window.clearTimeout(dateTimer);
  showDateOffers();
  dateTimer = window.setTimeout(() => {
    if (!applyTypedDate(dateInput.value)) return;
    state.limit = 400;
    reload();
  }, 250);
});
userInput.addEventListener("input", debounce(() => {
  state.author = userInput.value.trim();
  state.limit = 400;
  reload();
}, 200));
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.tab = tab.dataset.tab;
    render();
    if (state.tab === "git") loadWorktree();
  });
});
document.querySelector("#editor-close").addEventListener("click", closeEditor);
diffPrevFile.addEventListener("click", () => stepEditorFile(-1));
diffNextFile.addEventListener("click", () => stepEditorFile(1));
diffPrev.addEventListener("click", () => stepDifference(-1));
diffNext.addEventListener("click", () => stepDifference(1));
document.querySelector("#review-export").addEventListener("click", exportRevision);
document.querySelector("#review-commit").addEventListener("click", commitRevision);
editorBody.addEventListener("click", (event) => {
  const number = event.target.closest(".no");
  if (!number?.textContent) return;
  const line = number.closest(".diff-line");
  if (!line?.dataset.line) return;
  chooseReviewLine(line.dataset.side, Number(line.dataset.line), event.shiftKey);
});
branchFromClear.addEventListener("click", () => {
  state.branchFrom = null;
  renderChanges();
});
newBranchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  document.querySelector("#create-branch").click();
});
document.querySelector("#create-branch").addEventListener("click", () => {
  runRepoAction(async () => {
    const response = await window.jetGit.createBranch({
      root: state.root,
      name: newBranchInput.value,
      start: state.branchFrom,
    });
    if (!response.ok) {
      state.error = response.error;
      renderStatus();
      return;
    }
    newBranchInput.value = "";
    state.branchFrom = null;
    state.rev = null;
    branchInput.value = "";
    await finishNotice(`Branch ${response.data.name}`);
  });
});
function repoName(root) {
  const catalog = state.view?.catalog ?? [];
  return catalog.find((repo) => repo.root === root)?.name
    || String(root ?? "").split("/").filter(Boolean).pop()
    || "repository";
}

function shownRoots() {
  const catalog = state.view?.catalog ?? [];
  if (catalog.length === 0) {
    const root = activeRoot();
    return root ? [root] : [];
  }
  if (state.shownRepos) return state.shownRepos.filter((root) => catalog.some((repo) => repo.root === root));
  return catalog.map((repo) => repo.root);
}

function ensureRoot() {
  const root = activeRoot();
  if (!root) {
    state.error = "Open a repository first.";
    renderStatus();
    return null;
  }
  state.root = root;
  return root;
}

function collectRefs(root) {
  const found = [];
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.ref) found.push(node);
      walk(node.children);
    }
  };
  const repos = state.view?.repos ?? [];
  if (repos.length > 1) {
    const repo = repos.find((item) => item.root === root) ?? repos[0];
    walk(repo?.branches?.local);
    for (const remote of repo?.branches?.remotes ?? []) walk(remote.children);
    walk(repo?.branches?.tags);
    return found;
  }
  const panel = state.view?.branches;
  walk(panel?.local);
  for (const remote of panel?.remotes ?? []) walk(remote.children);
  walk(panel?.tags);
  if (panel?.head?.ref) found.push(panel.head);
  return found;
}

function branchRevision(root, name) {
  const known = collectRefs(root).find((node) => refLabel(node.ref) === name || node.label === name || node.ref === name);
  return known?.ref ?? name;
}

async function updateShown() {
  const roots = shownRoots();
  if (roots.length === 0) {
    state.error = "No repository to update.";
    renderStatus();
    return;
  }
  state.root = roots[0];
  await runRepoAction(async () => {
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      state.notice = roots.length === 1 ? "Updating…" : `Updating ${repoName(root)} (${index + 1} of ${roots.length})…`;
      state.error = null;
      renderStatus();
      const response = await window.jetGit.pull({ root });
      if (!response.ok) {
        await reload();
        state.error = `${repoName(root)}: ${response.error}`;
        renderStatus();
        return;
      }
    }
    await finishNotice(roots.length === 1 ? "Updated" : `Updated ${roots.length} repositories`);
  });
}

async function pullActive() {
  const root = ensureRoot();
  if (!root) return;
  await runRepoAction(async () => {
    const response = await window.jetGit.pull({ root });
    if (!response.ok) {
      state.error = response.error;
      renderStatus();
      return;
    }
    await finishNotice("Updated");
  });
}

async function pushActive() {
  const root = ensureRoot();
  if (!root) return;
  await runRepoAction(async () => {
    const response = await window.jetGit.push({ root });
    if (!response.ok) {
      state.error = response.error;
      renderStatus();
      return;
    }
    await finishNotice("Pushed");
  });
}

async function pushShown() {
  const roots = shownRoots();
  if (roots.length === 0) return;
  state.root = roots[0];
  await runRepoAction(async () => {
    for (const root of roots) {
      state.notice = `Pushing ${repoName(root)}…`;
      state.error = null;
      renderStatus();
      const response = await window.jetGit.push({ root });
      if (!response.ok) {
        await reload();
        state.error = `${repoName(root)}: ${response.error}`;
        renderStatus();
        return;
      }
    }
    await finishNotice(roots.length === 1 ? "Pushed" : `Pushed ${roots.length} repositories`);
  });
}

function commitShortcut() {
  if (!ensureRoot()) return;
  if (!commitMessage.value.trim() && !amendInput.checked) {
    state.tab = "git";
    render();
    commitMessage.focus();
    return;
  }
  document.querySelector("#commit-form").requestSubmit();
}

async function promptRevision(title, action, field, label) {
  const name = (await askText(title, ""))?.trim();
  if (!name) return;
  const root = ensureRoot();
  if (!root) return;
  await gitAction({ action, root, [field]: branchRevision(root, name) }, label);
}

async function checkoutNamed() {
  const name = (await askText("Checkout", ""))?.trim();
  if (!name) return;
  const root = ensureRoot();
  if (!root) return;
  await checkout(branchRevision(root, name), root);
}

async function cherryPickPrompt() {
  let hashes = sameRepoSelection().slice().reverse();
  if (hashes.length === 0) {
    const typed = (await askText("Cherry-pick", state.selected ?? ""))?.trim();
    if (!typed) return;
    hashes = [typed];
  }
  const root = ensureRoot();
  if (!root) return;
  await runRepoAction(async () => {
    for (const hash of hashes) {
      const response = await window.jetGit.action({ root, action: "cherry-pick", hash });
      if (!response.ok) {
        await reload();
        state.error = response.error;
        if (response.code === "CONFLICT") {
          state.tab = "git";
          render();
          await loadWorktree();
        } else renderStatus();
        return;
      }
    }
    await finishNotice("Cherry-picked");
  });
}

function revertPrompt() {
  const hashes = sameRepoSelection();
  if (hashes.length === 0) {
    state.error = "Select commits to revert.";
    renderStatus();
    return;
  }
  const root = ensureRoot();
  if (!root) return;
  gitAction({ action: "revert", root, hashes }, "Reverted");
}

function stashPrompt() {
  const message = window.prompt("Stash message");
  if (message == null) return;
  const root = ensureRoot();
  if (!root) return;
  gitAction({ action: "stash", root, message }, "Stashed");
}

function tagPrompt() {
  const hash = state.selected;
  if (!hash) {
    state.error = "Select a commit to tag.";
    renderStatus();
    return;
  }
  const name = window.prompt("Tag name");
  if (!name) return;
  const root = ensureRoot();
  if (!root) return;
  gitAction({ action: "create-tag", root, name, hash }, `Tag ${name}`);
}

function createPatchPrompt() {
  const hashes = sameRepoSelection();
  if (hashes.length === 0) {
    state.error = "Select commits to patch.";
    renderStatus();
    return;
  }
  const root = ensureRoot();
  if (!root) return;
  gitAction({ action: "create-patch", root, hashes }, "Patch saved");
}

function gitActions() {
  const many = shownRoots().length > 1;
  return [
    { label: "Update", aliases: "pull update project", hint: "⌘T", run: () => pullActive() },
    ...(many ? [{ label: "Update all shown repositories", aliases: "pull all", run: () => updateShown() }] : []),
    { label: "Commit", aliases: "commit changes", hint: "⌘K", run: () => commitShortcut() },
    { label: "Push", hint: "⌘⇧K", run: () => pushActive() },
    ...(many ? [{ label: "Push all shown repositories", aliases: "push all", run: () => pushShown() }] : []),
    { label: "Fetch", run: () => { const root = ensureRoot(); if (root) gitAction({ action: "fetch", root }, "Fetched"); } },
    { label: "Rebase onto…", aliases: "rebase", run: () => promptRevision("Rebase onto", "rebase", "upstream", "Rebased") },
    { label: "Merge into current…", aliases: "merge", run: () => promptRevision("Merge into current", "merge", "ref", "Merged") },
    { label: "Checkout…", aliases: "switch branch", run: () => checkoutNamed() },
    { label: "Cherry-pick", aliases: "cherry pick", run: () => cherryPickPrompt() },
    { label: "Revert selected commits", aliases: "revert", run: () => revertPrompt() },
    { label: "Stash changes…", aliases: "stash", run: () => stashPrompt() },
    { label: "Pop stash", aliases: "stash pop", run: () => { const root = ensureRoot(); if (root) gitAction({ action: "stash-pop", root }, "Stash applied"); } },
    { label: "New branch…", aliases: "branch", run: () => { if (!ensureRoot()) return; state.tab = "git"; render(); newBranchInput.focus(); } },
    { label: "New tag…", aliases: "tag", run: () => tagPrompt() },
    { label: "Abort rebase, merge or cherry-pick", aliases: "abort", run: () => { const root = ensureRoot(); if (root) gitAction({ action: "abort", root }, "Aborted"); } },
    { label: "Continue rebase, merge or cherry-pick", aliases: "continue", run: () => { const root = ensureRoot(); if (root) gitAction({ action: "continue", root }, "Continued"); } },
    { label: "Compare selected commits", aliases: "compare diff", hint: "⌘D", run: () => compareSelection() },
    { label: "Create patch…", aliases: "patch", run: () => createPatchPrompt() },
  ];
}

const actionsPane = document.querySelector("#actions");
const actionQuery = document.querySelector("#action-query");
const actionList = document.querySelector("#action-list");
let actionIndex = 0;
let lastShortcut = "";
let lastShortcutAt = 0;

function visibleActions() {
  const query = actionQuery.value;
  return gitActions().filter((action) => matchesName(query, `${action.label} ${action.aliases ?? ""}`));
}

function renderActionList() {
  const items = visibleActions();
  if (actionIndex >= items.length) actionIndex = Math.max(0, items.length - 1);
  actionList.replaceChildren();
  items.forEach((action, index) => {
    const button = document.createElement("button");
    button.type = "button";
    if (index === actionIndex) button.className = "current";
    const label = document.createElement("span");
    label.textContent = action.label;
    button.append(label);
    if (action.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = action.hint;
      button.append(hint);
    }
    button.addEventListener("click", () => pickAction(action));
    actionList.append(button);
  });
  actionList.querySelector(".current")?.scrollIntoView({ block: "nearest" });
}

function closeActions() {
  actionsPane.hidden = true;
}

function openActions() {
  if (finishAsk) return;
  actionIndex = 0;
  actionQuery.value = "";
  actionsPane.hidden = false;
  renderActionList();
  actionQuery.focus();
}

function pickAction(action) {
  closeActions();
  action.run();
}

function onceShortcut(name, run) {
  const now = Date.now();
  if (lastShortcut === name && now - lastShortcutAt < 400) return;
  lastShortcut = name;
  lastShortcutAt = now;
  run();
}

document.querySelector("#update").addEventListener("click", () => pullActive());
document.querySelector("#commit-now").addEventListener("click", () => commitShortcut());
document.querySelector("#push-now").addEventListener("click", () => pushActive());
document.querySelector("#actions-close").addEventListener("click", closeActions);
actionsPane.addEventListener("mousedown", (event) => {
  if (event.target === actionsPane) closeActions();
});
actionQuery.addEventListener("input", () => {
  actionIndex = 0;
  renderActionList();
});
document.querySelector("#pull").addEventListener("click", () => pullActive());
document.querySelector("#fetch").addEventListener("click", () => {
  gitAction({ action: "fetch" }, "Fetched");
});
document.querySelector("#stash").addEventListener("click", () => {
  const message = window.prompt("Stash message");
  if (message == null) return;
  gitAction({ action: "stash", message }, "Stashed");
});
document.querySelector("#stash-pop").addEventListener("click", () => {
  gitAction({ action: "stash-pop" }, "Stash applied");
});
document.querySelector("#conflict-continue").addEventListener("click", () => {
  gitAction({ action: "continue" }, "Continued");
});
document.querySelector("#conflict-abort").addEventListener("click", () => {
  gitAction({ action: "abort" }, "Aborted");
});
document.querySelector("#push").addEventListener("click", () => pushActive());
document.querySelector("#commit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runRepoAction(async () => {
    const response = await window.jetGit.commitChanges({
      root: state.root,
      message: commitMessage.value,
      amend: amendInput.checked,
    });
    if (!response.ok) {
      state.error = response.error;
      renderStatus();
      return;
    }
    commitMessage.value = "";
    amendInput.checked = false;
    await finishNotice("Committed");
  });
});
log.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
  }
});

for (const splitter of document.querySelectorAll(".splitter")) {
  splitter.addEventListener("pointerdown", (event) => {
    const side = splitter.dataset.split;
    const start = event.clientX;
    const initial = side === "branches" ? state.branchesWidth : state.detailsWidth;
    const move = (pointer) => {
      const delta = pointer.clientX - start;
      if (side === "branches") state.branchesWidth = Math.min(520, Math.max(180, initial + delta));
      else state.detailsWidth = Math.min(1100, Math.max(240, initial - delta));
      document.documentElement.style.setProperty("--branches-width", `${state.branchesWidth}px`);
      document.documentElement.style.setProperty("--details-width", `${state.detailsWidth}px`);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  });
}

editorSplitter.addEventListener("pointerdown", (event) => {
  const bounds = workspace.getBoundingClientRect();
  const move = (pointer) => {
    const ratio = (pointer.clientY - bounds.top) / bounds.height;
    const height = `${Math.round(Math.min(0.75, Math.max(0.18, ratio)) * 100)}%`;
    document.documentElement.style.setProperty("--editor-height", height);
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
});

document.querySelector("#settings-close").addEventListener("click", closeSettings);
settingsPane.addEventListener("mousedown", (event) => {
  if (event.target === settingsPane) closeSettings();
});
for (const id of ["#setting-theme", "#setting-translucent", "#setting-font", "#setting-syntax"]) {
  document.querySelector(id).addEventListener("change", persistSettings);
}

window.jetGit.onOpen(() => pickRepository());
window.jetGit.onFind(() => searchInput.focus());
window.jetGit.onSettings(() => openSettings());
window.jetGit.onCompare(() => compareSelection());
window.jetGit.onUpdate(() => onceShortcut("update", pullActive));
window.jetGit.onCommit(() => onceShortcut("commit", commitShortcut));
window.jetGit.onPush(() => onceShortcut("push", pushActive));
window.jetGit.onActions(() => onceShortcut("actions", openActions));
window.jetGit.onTheme((_event, data) => applySettings(data));
window.jetGit.settings().then((response) => {
  if (response.ok) applySettings(response.data);
});

window.jetGit.initial().then(async (response) => {
  if (response.ok && response.data?.active) {
    applySession(response.data);
    await reload();
    return;
  }
  if (response.ok && response.data) applySession(response.data);
  render();
});
