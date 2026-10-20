const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function skipMeta(line) {
  return line.startsWith("diff --git ")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
    || line.startsWith("new file ")
    || line.startsWith("deleted file ")
    || line.startsWith("old mode ")
    || line.startsWith("new mode ")
    || line.startsWith("similarity ")
    || line.startsWith("rename ")
    || line.startsWith("\\ ");
}

export function parseUnifiedDiff(text) {
  if (!text || text.startsWith("Binary files ")) return { binary: text.startsWith("Binary files "), rows: [] };
  const rows = [];
  let left = 0;
  let right = 0;
  let pending = [];
  const flush = () => {
    rows.push(...pending);
    pending = [];
  };
  for (const line of text.split("\n")) {
    if (skipMeta(line) || line.length === 0) continue;
    const hunk = HUNK.exec(line);
    if (hunk) {
      flush();
      left = Number(hunk[1]);
      right = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      const deleted = pending.shift();
      if (deleted) rows.push({ kind: "change", left: deleted.left, right, before: deleted.text, after: line.slice(1) });
      else rows.push({ kind: "add", right, text: line.slice(1) });
      right += 1;
      continue;
    }
    if (line.startsWith("-")) {
      pending.push({ kind: "del", left, text: line.slice(1) });
      left += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      flush();
      rows.push({ kind: "context", left, right, text: line.slice(1) });
      left += 1;
      right += 1;
    }
  }
  flush();
  return { binary: false, rows };
}

export function addedFileView(raw, max = 200_000) {
  const text = typeof raw === "string" ? raw : "";
  if (text.includes("\0")) return { binary: true, single: true, rows: [], size: text.length };
  const truncated = text.length > max;
  const body = truncated ? text.slice(0, max) : text;
  const lines = body.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return {
    binary: false,
    single: true,
    truncated,
    rows: lines.map((line, index) => ({ kind: "add", right: index + 1, text: line })),
  };
}

function gitDiffPath(header) {
  const body = header.slice("diff --git ".length);
  const parts = [];
  let index = 0;
  while (index < body.length) {
    if (body[index] === " ") {
      index += 1;
      continue;
    }
    if (body[index] === '"') {
      let end = index + 1;
      let value = "";
      while (end < body.length && body[end] !== '"') {
        if (body[end] === "\\" && end + 1 < body.length) {
          value += body[end + 1];
          end += 2;
          continue;
        }
        value += body[end];
        end += 1;
      }
      parts.push(value);
      index = end + 1;
      continue;
    }
    const next = body.indexOf(" ", index);
    parts.push(next < 0 ? body.slice(index) : body.slice(index, next));
    index = next < 0 ? body.length : next + 1;
  }
  if (parts.length < 2) return "";
  const right = parts[parts.length - 1].replace(/^b\//, "");
  const left = parts[parts.length - 2].replace(/^a\//, "");
  return right === "/dev/null" ? left : right;
}

function presentPiece(text, max = 200_000) {
  if (text.startsWith("Binary files ") || text.includes("\nBinary files ")) {
    return { binary: true, truncated: false, single: false, rows: [] };
  }
  const truncated = text.length > max;
  if (truncated) return { binary: false, truncated: true, single: false, rows: [] };
  const parsed = parseUnifiedDiff(text);
  const single = !parsed.rows.some((row) => row.kind === "del" || row.kind === "change" || row.kind === "context");
  return { truncated: false, single, ...parsed };
}

export function splitDiffFiles(text, max = 200_000) {
  const diffs = {};
  for (const part of String(text ?? "").split(/^(?=diff --git )/m)) {
    if (!part.startsWith("diff --git ")) continue;
    const file = gitDiffPath(part.split("\n", 1)[0]);
    if (!file) continue;
    diffs[file] = presentPiece(part, max);
  }
  return diffs;
}
