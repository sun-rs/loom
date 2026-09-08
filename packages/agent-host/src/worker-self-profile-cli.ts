import { WorkerSelfProfileUpdateRequestSchema } from "@rah-os/protocol";
export function parseWorkerSelfProfileCommand(
  command: string,
  options: Record<string, string>,
): { path: string; body: Record<string, unknown> } | undefined {
  if (command !== "profile-self-get" && command !== "profile-update")
    return undefined;
  const allowed =
    command === "profile-self-get"
      ? []
      : [
          "control-room-id",
          "control-room-seq",
          "expected-revision-id",
          "display-name",
          "description",
          "avatar-key",
          "avatar-upload-intent-id",
          "idempotency-key",
        ];
  for (const key of Object.keys(options))
    if (!allowed.includes(key))
      throw new Error(`unknown --${key} option for ${command}`);
  if (command === "profile-self-get")
    return { path: "/v1/worker/profile/self/get", body: {} };
  const patch: Record<string, string> = {};
  for (const [flag, key] of [
    ["display-name", "displayName"],
    ["description", "description"],
    ["avatar-key", "avatarKey"],
    ["avatar-upload-intent-id", "avatarUploadIntentId"],
  ] as const)
    if (options[flag] !== undefined) patch[key] = options[flag];
  return {
    path: "/v1/worker/profile/self/update",
    body: WorkerSelfProfileUpdateRequestSchema.parse({
      writeContext: {
        controlRoomId: options["control-room-id"],
        controlRoomSeq: Number(options["control-room-seq"]),
        expectedRevisionId: options["expected-revision-id"],
      },
      idempotencyKey: options["idempotency-key"],
      patch,
    }),
  };
}
