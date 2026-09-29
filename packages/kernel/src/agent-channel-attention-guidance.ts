import type { WorkerChannelAttentionResponse } from "@rah-os/protocol";

/**
 * Raft Computer 1.0.18 main.js:17204-17218 supplies the optional guidance shape;
 * 675385-675401 supplies its conditional renderer. These sentences describe
 * RAH's tested allowsAgentChannelAttention policy, not unseen Raft server copy.
 * No new policy or projection: the canonical service passes its current state.
 */
export function channelAttentionGuidance(
  muted: boolean,
  target: string,
): NonNullable<WorkerChannelAttentionResponse["attention"]> {
  // POSIX shell quoting: JSON escaping would still allow $() and backticks.
  const quotedTarget = "'" + target.replaceAll("'", "'\"'\"'") + "'";
  const command = `"$RAH_WORKER_CLI" worker ${muted ? "channel-unmute" : "channel-mute"} --target ${quotedTarget}`;
  return {
    state: muted ? "muted" : "unmuted",
    ordinaryActivity: muted
      ? "Ordinary Channel activity delivery is muted; existing queued work is unchanged."
      : "Ordinary Channel activity delivery is enabled for new activity.",
    stillArrives: [
      "Personal @mentions",
      "Replies in followed Threads",
      "Directly assigned Tasks",
    ],
    threadBoundary:
      "Thread following is independent of Channel mute; use Thread follow controls separately.",
    catchUp:
      "Suppressed activity is not replayed on unmute. Read Channel history to catch up.",
    ...(target.length <= 500 && command.length <= 2048
      ? muted
        ? { unmuteCommand: command }
        : { muteCommand: command }
      : {}),
  };
}
