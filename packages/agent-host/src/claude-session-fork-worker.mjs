// Standalone SDK disk operation. Never query(), spawn Claude, or load provider tools.
// A separate process keeps SDK configuration caches and HOME isolated per runtime.
import {
  forkSession,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { isDeepStrictEqual } from "node:util";

try {
  const sourceId = process.argv[2];
  const dir = process.cwd();
  const messages = async (id) =>
    (await getSessionMessages(id, { dir })).map((entry) => entry.message);
  const before = await messages(sourceId);
  if (!before.length) throw new Error("Source has no readable native context");
  const { sessionId } = await forkSession(sourceId, { dir });
  if (!sessionId || sessionId === sourceId)
    throw new Error("Copy must return an independent identity");
  if (
    !isDeepStrictEqual(before, await messages(sessionId)) ||
    !isDeepStrictEqual(before, await messages(sourceId))
  )
    throw new Error("Native context changed during copying");
  process.stdout.write(JSON.stringify({ sessionId }) + "\n");
} catch {
  // Never expose transcript bodies or provider configuration through API errors.
  process.stderr.write("Claude native session copy failed\n");
  process.exitCode = 1;
}
