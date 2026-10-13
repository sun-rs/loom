import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isSea } from "node:sea";
import type { NativeSessionCopyInput } from "./native-session-copy.ts";

const execute = promisify(execFile);
/** SDK storage only; later turns use the user's configured CLI, never the SDK runner. */
export async function copyClaudeSession(
  input: NativeSessionCopyInput,
): Promise<string> {
  if (isSea())
    throw new Error(
      "Claude native session copying is not packaged in this executable",
    );
  try {
    const { stdout } = await execute(
      process.execPath,
      [
        fileURLToPath(
          new URL("./claude-session-fork-worker.mjs", import.meta.url),
        ),
        input.sourceId,
      ],
      {
        cwd: input.cwd,
        env: input.env,
        timeout: 30_000,
        killSignal: "SIGKILL",
        maxBuffer: 4096,
        encoding: "utf8",
      },
    );
    const result = JSON.parse(stdout);
    if (
      typeof result.sessionId !== "string" ||
      !result.sessionId.trim() ||
      result.sessionId === input.sourceId
    )
      throw new Error("Invalid native copy identity");
    return result.sessionId;
  } catch {
    throw new Error(
      "Claude native session copy failed; no child was published",
    );
  }
}
