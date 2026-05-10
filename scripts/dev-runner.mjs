import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const clientDir = path.join(rootDir, "client");
const serverDir = path.join(rootDir, "server");
const hostMode = process.argv.includes("--host");

const children = new Set();

const run = (name, cwd, args) => {
  const command =
    process.platform === "win32"
      ? { file: "cmd.exe", args: ["/d", "/s", "/c", `npm ${args.join(" ")}`] }
      : { file: "npm", args };

  const child = spawn(command.file, command.args, {
    cwd,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
    env: process.env,
  });

  children.add(child);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (signal) {
      process.stderr.write(`[${name}] exited via signal ${signal}\n`);
    } else {
      process.stderr.write(`[${name}] exited with code ${code}\n`);
    }

    if (!shuttingDown) {
      shutdown(code ?? 0);
    }
  });

  return child;
};

const checkHealth = () =>
  new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4000/health", (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let shuttingDown = false;

const shutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    child.kill();
  }

  setTimeout(() => process.exit(exitCode), 200);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const server = run("server", serverDir, ["run", "dev"]);

const start = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await checkHealth()) {
      break;
    }

    if (server.exitCode !== null) {
      return;
    }

    await wait(500);
  }

  if (shuttingDown || server.exitCode !== null) {
    return;
  }

  const clientArgs = ["run", "dev"];
  if (hostMode) {
    clientArgs.push("--", "--host", "0.0.0.0");
  }

  run("client", clientDir, clientArgs);
};

void start();
