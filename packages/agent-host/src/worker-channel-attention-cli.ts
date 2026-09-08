import { WorkerChannelAttentionRequestSchema } from "@rah-os/protocol";
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
  return {
    path:
      command === "channel-mute"
        ? "/v1/worker/channels/mute"
        : "/v1/worker/channels/unmute",
    body: WorkerChannelAttentionRequestSchema.parse({
      channel: options.target ?? options.channel,
      contextReceipt: options["context-receipt"],
      basedOnRoomSeq: Number(options["based-on-room-seq"]),
      idempotencyKey: options["idempotency-key"],
    }),
  };
}
