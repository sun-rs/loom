import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";

/** Raft attachment upload owns clientRequestId (SEA 1.0.18:729856).
 * Local Artifact reservations additionally bind RunAttempt; a bounded content
 * digest preserves same-Run retry identity without asking the model for a key.
 * This deterministic key is RAH glue, not Raft's random UUID implementation. */
export async function deriveArtifactPublicationKey(input: {
  file: FileHandle;
  runAttemptId: string | undefined;
  taskId: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<string> {
  const run = input.runAttemptId;
  if (!run || run.length > 512 || run.includes("\0"))
    throw new Error(
      "Artifact publication needs its authenticated Run environment; use an explicit idempotency key only for legacy clients",
    );
  if (!Number.isSafeInteger(input.size) || input.size <= 0)
    throw new Error("Invalid artifact size");
  const before = await input.file.stat();
  if (before.size !== input.size)
    throw new Error("Artifact changed before publication");
  const content = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  while (position < input.size) {
    const { bytesRead } = await input.file.read(
      buffer,
      0,
      Math.min(buffer.length, input.size - position),
      position,
    );
    if (bytesRead === 0) throw new Error("Artifact changed while hashing");
    content.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  const after = await input.file.stat();
  if (
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  )
    throw new Error("Artifact changed while hashing");
  return `artifact:${createHash("sha256")
    .update(
      JSON.stringify([
        run,
        input.taskId,
        input.filename,
        input.mimeType,
        input.size,
        content.digest("hex"),
      ]),
    )
    .digest("hex")}`;
}
