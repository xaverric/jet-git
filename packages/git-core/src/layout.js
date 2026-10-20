const PALETTE_LENGTH = 8;

function placeParent(next, lane, occupied, parent, parentIndex) {
  if (parentIndex === 0) {
    next[lane] = parent;
    return lane;
  }
  const existing = next.findIndex((hash) => hash === parent);
  if (existing !== -1) return existing;
  const freed = occupied.find((candidate) => candidate !== lane && next[candidate] == null);
  if (freed != null) {
    next[freed] = parent;
    return freed;
  }
  const hole = next.findIndex((hash) => hash == null);
  if (hole !== -1) {
    next[hole] = parent;
    return hole;
  }
  next.push(parent);
  return next.length - 1;
}

export function layoutGraph(commits) {
  const visible = new Set(commits.map((commit) => commit.hash));
  let cursors = [];
  const laneColor = [];
  let colorSeq = 0;
  const rows = [];

  const assignColor = (lane, fresh) => {
    if (fresh || laneColor[lane] == null) {
      laneColor[lane] = colorSeq % PALETTE_LENGTH;
      colorSeq += 1;
    }
    return laneColor[lane];
  };

  for (const commit of commits) {
    const parents = commit.parents ?? [];
    const occupied = [];
    cursors.forEach((hash, index) => {
      if (hash === commit.hash) occupied.push(index);
    });

    let lane;
    let freshLane = false;
    if (occupied.length === 0) {
      lane = cursors.findIndex((hash) => hash == null);
      if (lane === -1) {
        lane = cursors.length;
        cursors.push(commit.hash);
      } else {
        cursors[lane] = commit.hash;
      }
      occupied.push(lane);
      freshLane = true;
    } else {
      lane = occupied[0];
    }

    const color = assignColor(lane, freshLane);
    const next = cursors.slice();
    for (const occupiedLane of occupied) next[occupiedLane] = null;

    const parentLanes = [];
    parents.forEach((parent, parentIndex) => {
      if (!visible.has(parent)) return;
      const target = placeParent(next, lane, occupied, parent, parentIndex);
      if (target !== lane) assignColor(target, next[target] === parent && cursors[target] !== parent);
      if (!parentLanes.includes(target)) parentLanes.push(target);
    });

    const lines = [];
    const width = Math.max(cursors.length, next.length);
    for (let index = 0; index < width; index += 1) {
      if (index === lane) continue;
      if (cursors[index] && next[index] && cursors[index] === next[index]) {
        lines.push({ type: "through", lane: index, color: laneColor[index] ?? 0 });
      }
    }
    for (const occupiedLane of occupied) {
      if (occupiedLane !== lane) {
        lines.push({ type: "into", fromLane: occupiedLane, color: laneColor[occupiedLane] ?? color });
      }
    }
    for (const toLane of parentLanes) {
      lines.push({
        type: "down",
        toLane,
        color: toLane === lane ? color : (laneColor[toLane] ?? color),
      });
    }

    rows.push({ ...commit, lane, color, lines });
    cursors = next;
    while (cursors.length > 0 && cursors[cursors.length - 1] == null) {
      cursors.pop();
      laneColor.pop();
    }
  }

  const columnCount = rows.reduce((max, row) => {
    const lanes = row.lines.map((line) => line.lane ?? line.toLane ?? line.fromLane ?? 0);
    return Math.max(max, row.lane + 1, ...lanes.map((item) => item + 1));
  }, 1);

  return rows.map((row) => ({ ...row, columnCount }));
}
