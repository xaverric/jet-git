export class GitCoreError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "GitCoreError";
    this.code = code ?? "GIT_ERROR";
  }
}
