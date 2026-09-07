import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import type {
  TaskDeliveryEvidenceBaseline,
  TaskDeliveryEvidenceCapture,
  TaskDeliveryEvidenceCollector,
} from "@rah-os/application-service";

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_PATCH_BYTES = 64 * 1024 * 1024;
const MAX_UNTRACKED_FILES = 1_000;

/**
 * Host-owned Git evidence capture. The Worker selects no commit or digest:
 * activation start fixes the base and task submission reads the same workspace.
 */
export class GitTaskDeliveryEvidenceCollector implements TaskDeliveryEvidenceCollector {
  async captureBaseline(input: {
    workspaceRoot: string;
  }): Promise<TaskDeliveryEvidenceBaseline> {
    let workspaceRoot: string;
    try {
      workspaceRoot = await realpath(input.workspaceRoot);
      if (!(await stat(workspaceRoot)).isDirectory()) {
        return {
          reason: "workspace_not_bound",
          source: "unavailable",
          workspaceRoot,
        };
      }
    } catch {
      return {
        reason: "workspace_not_bound",
        source: "unavailable",
        workspaceRoot: input.workspaceRoot,
      };
    }
    const identity = await runGit(
      workspaceRoot,
      ["rev-parse", "--show-toplevel", "HEAD"],
      { allowNotRepository: true },
    );
    if (identity === undefined) {
      return { reason: "not_git", source: "unavailable", workspaceRoot };
    }
    const lines = identity.toString("utf8").trim().split(/\r?\n/u);
    const repositoryRoot = lines[0];
    const baseCommit = lines[1];
    if (
      repositoryRoot === undefined ||
      baseCommit === undefined ||
      !/^[a-f0-9]{40,64}$/u.test(baseCommit)
    ) {
      return {
        reason: "capture_failed",
        source: "unavailable",
        workspaceRoot,
      };
    }
    return {
      baseCommit,
      repositoryId: digest(await realpath(repositoryRoot)),
      source: "git",
      workspaceRoot,
    };
  }

  async captureSubmission(input: {
    baseline: Extract<TaskDeliveryEvidenceBaseline, { source: "git" }>;
  }): Promise<TaskDeliveryEvidenceCapture> {
    const workspaceRoot = await realpath(input.baseline.workspaceRoot);
    if (workspaceRoot !== input.baseline.workspaceRoot) {
      throw new Error("workspace identity changed after activation");
    }
    const identity = await runGit(workspaceRoot, [
      "rev-parse",
      "--show-toplevel",
      "HEAD",
    ]);
    if (identity === undefined) throw new Error("Git repository disappeared");
    const lines = identity.toString("utf8").trim().split(/\r?\n/u);
    const repositoryRoot = lines[0];
    const headCommit = lines[1];
    if (
      repositoryRoot === undefined ||
      headCommit === undefined ||
      !/^[a-f0-9]{40,64}$/u.test(headCommit)
    ) {
      throw new Error("Git revision identity is invalid");
    }
    const canonicalRepositoryRoot = await realpath(repositoryRoot);
    const repositoryId = digest(canonicalRepositoryRoot);
    if (repositoryId !== input.baseline.repositoryId) {
      throw new Error("Git repository changed after activation");
    }
    const workspaceRelativePath = relative(
      canonicalRepositoryRoot,
      workspaceRoot,
    );
    if (
      isAbsolute(workspaceRelativePath) ||
      workspaceRelativePath === ".." ||
      workspaceRelativePath.startsWith(`..${sep}`)
    ) {
      throw new Error("workspace is outside its Git repository");
    }
    const workspacePathspec =
      workspaceRelativePath === ""
        ? "."
        : workspaceRelativePath.split(sep).join("/");

    const chunks = [
      await requiredGit(canonicalRepositoryRoot, [
        "--literal-pathspecs",
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        input.baseline.baseCommit,
        "--",
        workspacePathspec,
      ]),
    ];
    const untracked = await requiredGit(canonicalRepositoryRoot, [
      "--literal-pathspecs",
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      workspacePathspec,
    ]);
    const paths = untracked
      .toString("utf8")
      .split("\u0000")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    if (paths.length > MAX_UNTRACKED_FILES) {
      throw new Error("too many untracked files to freeze safely");
    }
    let totalBytes = chunks[0]!.byteLength;
    for (const path of paths) {
      if (path.includes("\ufffd")) {
        throw new Error("an untracked Git path is not valid UTF-8");
      }
      const chunk = await requiredGit(
        canonicalRepositoryRoot,
        [
          "diff",
          "--no-index",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          "--no-textconv",
          "--",
          "/dev/null",
          path,
        ],
        [0, 1],
      );
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_PATCH_BYTES) {
        throw new Error("Git delivery patch exceeds the bounded evidence size");
      }
      chunks.push(chunk);
    }
    return {
      baseCommit: input.baseline.baseCommit,
      headCommit,
      patch: Buffer.concat(chunks),
      repositoryId,
    };
  }
}

async function requiredGit(
  cwd: string,
  args: readonly string[],
  acceptedExitCodes: readonly number[] = [0],
): Promise<Buffer> {
  const result = await runProcess("git", args, cwd, acceptedExitCodes);
  if (result.byteLength > MAX_PATCH_BYTES) {
    throw new Error("Git evidence output exceeds the bounded size");
  }
  return result;
}

async function runGit(
  cwd: string,
  args: readonly string[],
  options: { allowNotRepository?: boolean } = {},
): Promise<Buffer | undefined> {
  try {
    return await requiredGit(cwd, args);
  } catch (error) {
    if (
      options.allowNotRepository &&
      error instanceof Error &&
      /not a git repository/u.test(error.message)
    ) {
      return undefined;
    }
    throw error;
  }
}

async function runProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  acceptedExitCodes: readonly number[],
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PATCH_BYTES) {
        child.kill("SIGKILL");
        finish(() =>
          reject(new Error("Git evidence output exceeded its limit")),
        );
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) =>
      finish(() => {
        if (code !== null && acceptedExitCodes.includes(code)) {
          resolve(Buffer.concat(stdout));
          return;
        }
        reject(
          new Error(
            `git exited ${String(code)}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
      }),
    );
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("Git evidence capture timed out")));
    }, COMMAND_TIMEOUT_MS);
    timer.unref();
  });
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
