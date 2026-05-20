import { spawn } from "child_process";

export interface AdminScriptDefinition {
  id: string;
  label: string;
  description: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface AdminScriptResult {
  script: Pick<AdminScriptDefinition, "id" | "label" | "description">;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const serverCwd = process.cwd();
const MAX_OUTPUT_LENGTH = 20_000;

const adminScripts: AdminScriptDefinition[] = [
  {
    id: "prisma-migrate-deploy",
    label: "Apply Prisma migrations",
    description: "Runs pending Prisma migrations against the configured database.",
    command: npxCommand,
    args: ["prisma", "migrate", "deploy"],
    cwd: serverCwd,
    timeoutMs: 5 * 60 * 1000,
  },
  {
    id: "prisma-generate",
    label: "Generate Prisma client",
    description: "Regenerates the Prisma client from the current schema.",
    command: npxCommand,
    args: ["prisma", "generate"],
    cwd: serverCwd,
    timeoutMs: 2 * 60 * 1000,
  },
  {
    id: "prisma-validate",
    label: "Validate Prisma schema",
    description: "Checks that the Prisma schema is valid.",
    command: npxCommand,
    args: ["prisma", "validate"],
    cwd: serverCwd,
    timeoutMs: 60 * 1000,
  },
];

const truncateOutput = (value: string) =>
  value.length > MAX_OUTPUT_LENGTH
    ? `${value.slice(value.length - MAX_OUTPUT_LENGTH)}\n\n[Output truncated to the last ${MAX_OUTPUT_LENGTH} characters.]`
    : value;

export const listAdminScripts = () =>
  adminScripts.map(({ id, label, description }) => ({ id, label, description }));

export const runAdminScript = async (scriptId: string): Promise<AdminScriptResult | null> => {
  const script = adminScripts.find((entry) => entry.id === scriptId);
  if (!script) return null;

  const startedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(script.command, script.args, {
      cwd: script.cwd,
      env: process.env,
      windowsHide: true,
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({
        script: {
          id: script.id,
          label: script.label,
          description: script.description,
        },
        exitCode,
        timedOut,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, script.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      finish(exitCode);
    });
  });
};
