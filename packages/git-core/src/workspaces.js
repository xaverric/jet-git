function parentPath(value) {
  const slash = String(value).lastIndexOf("/");
  if (slash <= 0) return "";
  return value.slice(0, slash);
}

function baseName(value) {
  const slash = String(value).lastIndexOf("/");
  return slash < 0 ? value : value.slice(slash + 1);
}

function containsPath(parent, child) {
  return child !== parent && child.startsWith(`${parent}/`);
}

function dropContained(projects) {
  const map = new Map();
  const next = [];
  for (const project of projects) {
    const ancestors = projects
      .filter((other) => other.host === project.host && other.id !== project.id && containsPath(other.path, project.path))
      .sort((left, right) => left.path.length - right.path.length);
    if (ancestors[0]) map.set(project.id, ancestors[0].id);
    else next.push(project);
  }
  return { projects: next, map };
}

function groupSiblings(projects) {
  const groups = new Map();
  for (const project of projects) {
    const parent = parentPath(project.path);
    if (!parent) continue;
    const key = `${project.host}\0${parent}`;
    const list = groups.get(key) ?? [];
    list.push(project);
    groups.set(key, list);
  }
  const consumed = new Set();
  const replacements = new Map();
  const created = [];
  for (const [key, list] of groups) {
    if (list.length < 2 || list.some((project) => project.workspace === true)) continue;
    const [host, parent] = key.split("\0");
    const workspace = {
      id: `${host}:${parent}`,
      host,
      path: parent,
      name: baseName(parent),
      workspace: true,
    };
    for (const project of list) {
      consumed.add(project.id);
      replacements.set(project.id, workspace.id);
    }
    if (!created.some((item) => item.id === workspace.id) && !projects.some((item) => item.id === workspace.id && !consumed.has(item.id))) {
      created.push(workspace);
    }
  }
  const next = [
    ...created,
    ...projects.filter((project) => !consumed.has(project.id)),
  ];
  return { projects: next, replacements, changed: consumed.size > 0 };
}

function follow(id, map) {
  const seen = new Set();
  let current = id;
  while (current && map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current);
  }
  return current;
}

export function collapseSiblingProjects(projects, active = null) {
  const map = new Map();
  const dropped = dropContained((projects ?? []).map((project) => ({ ...project })));
  for (const [from, to] of dropped.map) map.set(from, to);
  const grouped = groupSiblings(dropped.projects);
  for (const [from, to] of grouped.replacements) map.set(from, to);
  const current = grouped.projects.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  const nextActive = follow(active, map);
  const activeId = current.some((project) => project.id === nextActive) ? nextActive : (current[0]?.id ?? null);
  return { projects: current, active: activeId };
}
