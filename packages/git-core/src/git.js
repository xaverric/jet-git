import { execFile, spawn } from "node:child_process";
import { GitCoreError } from "./errors.js";

const MAX_BUFFER = 32 * 1024 * 1024;

export function parseLocation(input) {
  if (typeof input !== "string" || !input.startsWith("ssh://")) return { host: null, path: input };
  const rest = input.slice("ssh://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) throw new GitCoreError("Repository path is missing.", { code: "NOT_A_REPOSITORY" });
  const host = rest.slice(0, slash);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(host)) {
    throw new GitCoreError("Unsupported host.", { code: "BAD_PATH" });
  }
  return { host, path: rest.slice(slash) };
}

export function formatLocation(host, filePath) {
  if (!host) return filePath;
  return `ssh://${host}${filePath.startsWith("/") ? filePath : `/${filePath}`}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function sshArgv(host, remote) {
  return [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=12",
    "-o", "ControlMaster=auto",
    "-o", "ControlPersist=180",
    "-o", "ControlPath=/tmp/jetgit-%C",
    host,
    remote,
  ];
}

export function remoteCommand(host, command) {
  parseLocation(`ssh://${host}/`);
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      sshArgv(host, command),
      { maxBuffer: MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(new GitCoreError((stderr || error.message).trim(), { code: "GIT_ERROR" }));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function gitEnv(extra) {
  return {
    ...process.env,
    ...extra,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
  };
}

function capture(command, argv, { cwd, env, input, ok }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd, env, windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new GitCoreError("Git is not installed or not on PATH.", { code: "GIT_NOT_FOUND" }));
        return;
      }
      reject(error);
    });
    child.on("close", (status) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (ok.has(status ?? 1)) {
        resolve(stdout);
        return;
      }
      const wrapped = new GitCoreError((stderr || `git exited ${status}`).trim(), { code: "GIT_ERROR" });
      wrapped.exitCode = status;
      reject(wrapped);
    });
    child.stdin.end(input ?? "");
  });
}

export function remoteGitCommand(filePath, args) {
  const quoted = ["git", "-C", filePath, ...args].map(shellQuote).join(" ");
  return `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never ${quoted}`;
}

export function parseGitBatch(stdout, marker, count) {
  const results = [];
  let rest = String(stdout ?? "");
  for (let index = 0; index < count; index += 1) {
    const outTag = `${marker}OUT${index}\n`;
    const errTag = `${marker}ERR${index}\n`;
    const codeTag = `${marker}CODE${index}\n`;
    const outAt = rest.indexOf(outTag);
    const errAt = rest.indexOf(errTag);
    const codeAt = rest.indexOf(codeTag);
    if (outAt < 0 || errAt < outAt || codeAt < errAt) {
      throw new GitCoreError("Remote git result is incomplete.", { code: "GIT_ERROR" });
    }
    const out = rest.slice(outAt + outTag.length, errAt);
    const err = rest.slice(errAt + errTag.length, codeAt);
    const after = rest.slice(codeAt + codeTag.length);
    const lineEnd = after.indexOf("\n");
    const code = Number(lineEnd < 0 ? after.trim() : after.slice(0, lineEnd));
    rest = lineEnd < 0 ? "" : after.slice(lineEnd + 1);
    results.push({ stdout: out, stderr: err, code });
  }
  return results;
}

function remoteGitBatch(filePath, batches) {
  const marker = `@@JET${Math.random().toString(36).slice(2)}@@`;
  const runs = batches.map((args, index) => {
    const cmd = ["git", "-C", filePath, ...args].map(shellQuote).join(" ");
    return `${cmd} >"$d/${index}.out" 2>"$d/${index}.err"; echo $? >"$d/${index}.code"`;
  }).join("\n");
  const dump = batches.map((_, index) => [
    `printf '%s\\n' '${marker}OUT${index}'`,
    `cat "$d/${index}.out"`,
    `printf '%s\\n' '${marker}ERR${index}'`,
    `cat "$d/${index}.err"`,
    `printf '%s\\n' '${marker}CODE${index}'`,
    `cat "$d/${index}.code"`,
  ].join("\n")).join("\n");
  const script = `d=$(mktemp -d)\ntrap 'rm -rf "$d"' EXIT\n${runs}\n${dump}`;
  return { marker, command: `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never sh -c ${shellQuote(script)}` };
}

export async function gitAll(cwd, batches) {
  const location = parseLocation(cwd);
  if (!location.host) {
    return Promise.all(batches.map(async (args) => {
      try {
        return { stdout: await git(cwd, args), stderr: "", code: 0 };
      } catch (error) {
        return { stdout: "", stderr: error.message ?? "", code: error.exitCode ?? 1 };
      }
    }));
  }
  const { marker, command } = remoteGitBatch(location.path, batches);
  const stdout = await capture("ssh", sshArgv(location.host, command), {
    env: gitEnv(),
    ok: new Set([0]),
  });
  return parseGitBatch(stdout, marker, batches.length);
}

export function git(cwd, args, options = {}) {
  const location = parseLocation(cwd);
  const ok = new Set([0, ...(options.okStatus ?? [])]);
  const command = location.host ? "ssh" : "git";
  const argv = location.host ? sshArgv(location.host, remoteGitCommand(location.path, args)) : args;
  if (options.input != null) {
    return capture(command, argv, {
      cwd: location.host ? undefined : location.path,
      env: gitEnv(options.env),
      input: options.input,
      ok,
    });
  }
  return new Promise((resolve, reject) => {
    execFile(
      command,
      argv,
      {
        cwd: location.host ? undefined : location.path,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: gitEnv(options.env),
      },
      (error, stdout, stderr) => {
        const status = typeof error?.status === "number"
          ? error.status
          : (typeof error?.code === "number" ? error.code : 0);
        if (!error || ok.has(status)) {
          resolve(stdout);
          return;
        }
        if (error.code === "ENOENT") {
          reject(new GitCoreError("Git is not installed or not on PATH.", { code: "GIT_NOT_FOUND" }));
          return;
        }
        const wrapped = new GitCoreError((stderr || error.message).trim(), { code: "GIT_ERROR" });
        wrapped.exitCode = error.code ?? error.status;
        reject(wrapped);
      },
    );
  });
}
