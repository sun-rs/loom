import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { stopOpenCodeServer as stopCopyProcess } from "./opencode-server-process.js";
import {
  findPiSessionFile,
  piSessionDirectory,
  readPiNativeFile,
} from "./pi-session-files.ts";
import type { NativeSessionCopyInput } from "./native-session-copy.ts";

type CopyState = { sessionId: string; sessionFile: string };
/** --fork copies before startup; resuming the source then RPC clone can mutate it. */
export async function copyPiSession(
  input: NativeSessionCopyInput,
): Promise<string> {
  try {
    if (!input.supervisorDirectory) throw new Error("Missing Host storage");
    const directory = piSessionDirectory(input.supervisorDirectory);
    const source = await findPiSessionFile(
      input.supervisorDirectory,
      input.sourceId,
    );
    const before = await readPiNativeFile(source);
    const child = spawn(
      input.executable,
      [
        "--offline",
        "--mode",
        "rpc",
        "--fork",
        source,
        "--session-dir",
        directory,
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-prompt-templates",
        "--no-mcp",
        "--no-approve",
      ],
      {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let state: CopyState;
    let rejectResponse: (error: Error) => void = () => {};
    const fail = () =>
      rejectResponse(new Error("Pi native copy transport failed"));
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stderr.resume();
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolveExit) =>
        child.once("close", (code, signal) => {
          fail();
          resolveExit({ code, signal });
        }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      state = await new Promise<CopyState>((resolveState, reject) => {
        rejectResponse = reject;
        timer = setTimeout(fail, 30_000);
        let buffer = "",
          bytes = 0;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 64 * 1024) {
            fail();
            return;
          }
          buffer += chunk;
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            let frame;
            try {
              frame = JSON.parse(line);
            } catch {
              continue;
            }
            if (frame.type !== "response" || frame.id !== "loom-copy") continue;
            if (
              frame.command !== "get_state" ||
              !frame.success ||
              typeof frame.data?.sessionId !== "string" ||
              typeof frame.data?.sessionFile !== "string"
            ) {
              fail();
              return;
            }
            resolveState(frame.data);
          }
        });
        // Read native metadata only. No prompt, tool, resume or model generation.
        child.stdin.write(
          JSON.stringify({ id: "loom-copy", type: "get_state" }) + "\n",
        );
      });
    } finally {
      clearTimeout(timer);
      await stopCopyProcess({ child, exited }, { termTimeoutMs: 2_000 });
    }
    if (
      !state.sessionId.trim() ||
      state.sessionId === input.sourceId ||
      dirname(resolve(state.sessionFile)) !== resolve(directory)
    )
      throw new Error("Invalid native identity");
    const target = await findPiSessionFile(
      input.supervisorDirectory,
      state.sessionId,
    );
    if (resolve(target) !== resolve(state.sessionFile) || target === source)
      throw new Error("Invalid native file");
    const entries = (text: string) =>
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const original = entries(before).slice(1),
      copied = entries(await readPiNativeFile(target)).slice(1);
    if (
      !original.length ||
      !isDeepStrictEqual(original, copied.slice(0, original.length)) ||
      (await readPiNativeFile(source)) !== before
    )
      throw new Error("Native context changed");
    return state.sessionId;
  } catch {
    throw new Error("Pi native copy failed; no child was published");
  }
}
