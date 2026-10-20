function compareLabel(left, right) {
  return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
}

function sortTree(nodes) {
  nodes.sort((left, right) => {
    const leftDate = left.date || 0;
    const rightDate = right.date || 0;
    if (leftDate !== rightDate) return rightDate - leftDate;
    return compareLabel(left, right);
  });
  for (const node of nodes) sortTree(node.children);
}

function insert(nodes, parts, leaf) {
  let level = nodes;
  const built = [];
  for (let index = 0; index < parts.length; index += 1) {
    const label = parts[index];
    built.push(label);
    const last = index === parts.length - 1;
    let node = level.find((item) => item.label === label);
    if (!node) {
      node = {
        id: `${leaf.scope}:${built.join("/")}`,
        label,
        ref: null,
        hash: null,
        current: false,
        children: [],
      };
      level.push(node);
    }
    if (last) {
      node.ref = leaf.ref;
      node.hash = leaf.hash;
      node.current = leaf.current;
      node.date = leaf.date ?? 0;
    }
    level = node.children;
  }
}

function treeFrom(scope, leaves) {
  const nodes = [];
  for (const leaf of leaves) {
    insert(nodes, leaf.name.split("/"), { ...leaf, scope });
  }
  sortTree(nodes);
  return nodes;
}

export function parseRefRecords(text) {
  if (!text) return [];
  return text.split(/\r?\n|\0/).filter(Boolean).flatMap((record) => {
    const parts = record.split("\t");
    let hash;
    let peeled;
    let date;
    let refname;
    let current;
    if (parts.length >= 5) {
      [hash, peeled, date, refname, current] = parts;
    } else {
      [hash, refname, current] = parts;
      peeled = "";
      date = "";
    }
    if (!refname || refname.endsWith("/HEAD")) return [];
    return [{
      hash,
      peeled: peeled || hash,
      date: Number(date) || 0,
      refname,
      current: current === "1",
    }];
  });
}

export function buildBranchPanel(records, head) {
  const local = [];
  const tags = [];
  const remoteGroups = new Map();

  for (const record of records) {
    if (record.refname.startsWith("refs/heads/")) {
      const name = record.refname.slice("refs/heads/".length);
      local.push({
        name,
        ref: record.refname,
        hash: record.hash,
        current: record.current || (head?.name === name && !head.detached),
      });
    } else if (record.refname.startsWith("refs/tags/")) {
      const name = record.refname.slice("refs/tags/".length);
      tags.push({
        name,
        ref: record.refname,
        hash: record.peeled || record.hash,
        date: record.date,
        current: false,
      });
    } else if (record.refname.startsWith("refs/remotes/")) {
      const rest = record.refname.slice("refs/remotes/".length);
      const slash = rest.indexOf("/");
      if (slash === -1) continue;
      const remote = rest.slice(0, slash);
      const name = rest.slice(slash + 1);
      if (!remoteGroups.has(remote)) remoteGroups.set(remote, []);
      remoteGroups.get(remote).push({ name, ref: record.refname, hash: record.hash, current: false });
    }
  }

  const current = local.find((item) => item.current);
  const headRow = head?.detached
    ? { label: "Detached HEAD", ref: head.hash, hash: head.hash, detached: true }
    : current
      ? { label: current.name, ref: current.ref, hash: current.hash, detached: false }
      : { label: head?.name ?? "HEAD", ref: null, hash: head?.hash ?? null, detached: false };

  const remotes = [...remoteGroups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: "base" }))
    .map(([name, leaves]) => ({
      id: `remote:${name}`,
      name,
      children: treeFrom(`remote:${name}`, leaves),
    }));

  return {
    head: headRow,
    local: treeFrom("local", local),
    remotes,
    tags: treeFrom("tag", tags),
  };
}
