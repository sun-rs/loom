import { WorkerChannelAttentionRequestSchema } from "@rah-os/protocol";
/**
 * Raft: `raft channel mute|unmute --target '#engineering'` — the target and
 * nothing else. The causal cursor, the idempotency key and the context receipt
 * stay accepted as explicit forms, and the server derives the first two when
 * they are omitted.
 */
export function parseWorkerChannelAttentionCommand(
  command: string,
  options: Record<string, string>,
): { path: string; body: Record<string, unknown> } | undefined {
  if (command !== "channel-mute" && command !== "channel-unmute")
    return undefined;
  for (const key of Object.keys(options))
    if (
      ![
        "based-on-room-seq",
        "idempotency-key",
        "target",
        "channel",
        "context-receipt",
      ].includes(key)
    )
      throw new Error(`unknown --${key} option for ${command}`);
  if (options.target && options.channel && options.target !== options.channel)
    throw new Error("--target and --channel disagree");
  const channel = options.target ?? options.channel;
  return {
    path:
      command === "channel-mute"
        ? "/v1/worker/channels/mute"
        : "/v1/worker/channels/unmute",
    body: WorkerChannelAttentionRequestSchema.parse({
      ...(channel === undefined ? {} : { channel }),
      ...(options["context-receipt"] === undefined
        ? {}
        : { contextReceipt: options["context-receipt"] }),
      ...(options["based-on-room-seq"] === undefined
        ? {}
        : { basedOnRoomSeq: Number(options["based-on-room-seq"]) }),
      ...(options["idempotency-key"] === undefined
        ? {}
        : { idempotencyKey: options["idempotency-key"] }),
    }),
  };
}
