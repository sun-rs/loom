import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/**
 * S2-a per-turn Worker authority for warm runtimes (S2 spec §3, 方案 C).
 *
 * A warm Provider process outlives its turns, so a per-process environment
 * can no longer name the current Activation. Each turn instead gets a random
 * 128-bit handle naming `<turn root>/<handle>/{token,scope.json}`. The root is
 * mode 0300: its owner can enter a known name but cannot list it, so a tool
 * left running from turn N, which only ever saw handle N, cannot discover
 * handle N+1. The handle reaches the model only in its turn's wake text, and
 * the Worker CLI requires it explicitly (`--turn <handle>`); no command
 * reveals the current handle. At turn end the credential is revoked and the
 * directory removed before the turn quiesces.
 *
 * Honest limit (unchanged threat model): this prevents unintended cross-turn
 * authority from leftover tools, helpers and model confusion. Same-UID code
 * that deliberately chmods the root or reads Host state is out of scope.
 */
export const RAH_WORKER_TURN_ROOT_ENV = "RAH_WORKER_TURN_ROOT";
export const WORKER_TURN_HANDLE_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const MAX_TOKEN_BYTES = 65_536;

/** Per-turn identity values moved out of a warm process's environment. */
export const WORKER_TURN_SCOPE_KEYS: readonly string[] = [
  "RAH_ACTIVATION_ID",
  "RAH_ACTIVATION_REASON",
  "RAH_AGENT_CONTEXT_JSON",
  "RAH_CONSUMER_ID",
  "RAH_CONTEXT_MANIFEST_JSON",
  "RAH_FROM_SEQ",
  "RAH_ROOM_ID",
  "RAH_RUN_ATTEMPT_ID",
  "RAH_TO_SEQ",
];

export type WorkerTurnHandle = {
  handle: string;
  tokenPath: string;
  /** Revoke, then remove; both attempted, never thrown. Idempotent. */
  release(): Promise<WorkerTurnReleaseOutcome>;
};

export type WorkerTurnReleaseOutcome = {
  removed: boolean;
  revoked: boolean;
  removeError?: string;
  revokeError?: string;
};

/** Create `<runtimeDirectory>/turns` (0300) under a 0700 runtime directory. */
export async function createWorkerTurnRoot(
  runtimeDirectory: string,
): Promise<string> {
  if (!isAbsolute(runtimeDirectory))
    throw new Error("warm runtime directory must be absolute");
  await mkdir(runtimeDirectory, { mode: 0o700, recursive: true });
  await assertOwnerDirectory(runtimeDirectory, 0o700);
  const root = join(runtimeDirectory, "turns");
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o300);
  await assertOwnerDirectory(root, 0o300);
  return root;
}

export async function issueWorkerTurnHandle(
  root: string,
  input: {
    revoke: () => Promise<void> | void;
    scope: Readonly<Record<string, string>>;
    token: string;
  },
): Promise<WorkerTurnHandle> {
  const tokenBytes = Buffer.byteLength(input.token);
  if (
    tokenBytes === 0 ||
    tokenBytes > MAX_TOKEN_BYTES ||
    /[\0\r\n]/u.test(input.token)
  )
    throw new Error("Worker turn token must be a bounded single-line value");
  for (const key of Object.keys(input.scope))
    if (!WORKER_TURN_SCOPE_KEYS.includes(key))
      throw new Error(`Worker turn scope cannot carry ${key}`);
  const handle = randomBytes(16).toString("base64url");
  const directory = join(root, handle);
  await mkdir(directory, { mode: 0o700 });
  try {
    await writePrivateFile(join(directory, "token"), input.token);
    await writePrivateFile(
      join(directory, "scope.json"),
      JSON.stringify(input.scope),
    );
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
  let released: Promise<WorkerTurnReleaseOutcome> | undefined;
  return {
    handle,
    tokenPath: join(directory, "token"),
    release: () => {
      released ??= (async () => {
        const outcome: WorkerTurnReleaseOutcome = {
          removed: false,
          revoked: false,
        };
        try {
          await input.revoke();
          outcome.revoked = true;
        } catch (error) {
          outcome.revokeError = errorMessage(error);
        }
        try {
          await rm(directory, { force: true, recursive: true });
          outcome.removed = true;
        } catch (error) {
          outcome.removeError = errorMessage(error);
        }
        return outcome;
      })();
      return released;
    },
  };
}

/** Runtime end / janitor: make the root listable again, then remove it. */
export async function removeWorkerTurnRoot(root: string): Promise<void> {
  try {
    await chmod(root, 0o700);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return;
    throw error;
  }
  await rm(root, { force: true, recursive: true });
}

/**
 * Worker CLI side. With `RAH_WORKER_TURN_ROOT` set (warm runtime), every
 * Worker command must carry `--turn <handle>`; the handle's token and scope
 * become this invocation's credential path and per-turn identity. Without it
 * the legacy environment path is untouched.
 */
export async function resolveWorkerTurnInvocation(
  arguments_: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<
  | {
      arguments_: readonly string[];
      env: Readonly<Record<string, string | undefined>>;
    }
  | { error: { code: string; message: string } }
> {
  const root = env[RAH_WORKER_TURN_ROOT_ENV];
  if (root === undefined || root === "") return { arguments_, env };
  const index = arguments_.indexOf("--turn");
  if (index < 0 || arguments_[index + 1] === undefined)
    return {
      error: {
        code: "TURN_HANDLE_REQUIRED",
        message:
          "This runtime requires `--turn <handle>` on every Worker command; use the handle given in the latest wake.",
      },
    };
  const handle = arguments_[index + 1]!;
  const remaining = [
    ...arguments_.slice(0, index),
    ...arguments_.slice(index + 2),
  ];
  if (!isAbsolute(root) || !WORKER_TURN_HANDLE_PATTERN.test(handle))
    return {
      error: {
        code: "TURN_HANDLE_INVALID",
        message: "`--turn` must be the exact handle given in the latest wake.",
      },
    };
  const directory = join(root, handle);
  let scope: Record<string, string>;
  try {
    scope = JSON.parse(await readPrivateFile(join(directory, "scope.json")));
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT")
      return {
        error: {
          code: "TURN_HANDLE_INACTIVE",
          message:
            "This turn handle is no longer active; use the handle given in the latest wake.",
        },
      };
    return {
      error: {
        code: "TOKEN_FILE_UNREADABLE",
        message: "The turn credential is not an owner-private regular file.",
      },
    };
  }
  const overlay: Record<string, string> = {};
  for (const key of WORKER_TURN_SCOPE_KEYS)
    if (typeof scope[key] === "string") overlay[key] = scope[key];
  return {
    arguments_: remaining,
    env: {
      ...env,
      ...overlay,
      RAH_WORKER_SESSION_FILE: join(directory, "token"),
    },
  };
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(content, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function readPrivateFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      metadata.size > MAX_TOKEN_BYTES ||
      (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    )
      throw Object.assign(new Error("not owner-private"), { code: "EPERM" });
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

async function assertOwnerDirectory(path: string, mode: number): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== mode ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  )
    throw new Error(`warm runtime directory is not owner-controlled: ${path}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
