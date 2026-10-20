const FIELD = "\x1f";
const RECORD = "\0";

export const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%aI", "%D", "%s", "%b"].join(FIELD);

export function parseDecorations(value) {
  if (!value) return [];
  return value.split(", ").map((part) => {
    let name = part.trim();
    let head = false;
    if (name.startsWith("HEAD -> ")) {
      head = true;
      name = name.slice("HEAD -> ".length);
    }
    const tag = name.startsWith("tag: ");
    if (tag) name = name.slice("tag: ".length);
    return { name, head, tag };
  }).filter((item) => item.name.length > 0 && item.name !== "grafted");
}

export function parseLog(text) {
  if (!text) return [];
  return text.split(RECORD).filter(Boolean).map((record) => {
    const [hash, parents, authorName, authorEmail, authoredAt, decorations, subject, ...bodyParts] = record.split(FIELD);
    return {
      hash,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      authorName: authorName ?? "",
      authorEmail: authorEmail ?? "",
      authoredAt: authoredAt ?? "",
      decorations: parseDecorations(decorations ?? ""),
      subject: subject ?? "",
      body: bodyParts.join(FIELD).replace(/\n$/, ""),
    };
  });
}

export function parseNameStatus(text) {
  const parts = text.split(RECORD).filter((part) => part.length > 0);
  const files = [];
  for (let index = 0; index < parts.length - 1; index += 2) {
    files.push({ status: parts[index], path: parts[index + 1] });
  }
  return files;
}
