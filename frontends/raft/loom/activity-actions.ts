import type { HumanActivityMarkRequest } from "@rah-os/protocol";
export type ActivityAction = HumanActivityMarkRequest["action"];
export function activityMarkRequest(
  row: {
    message: { roomId: string };
    activityFrontier?: { throughSeq: number; threadId?: string };
  },
  action: ActivityAction,
): HumanActivityMarkRequest | undefined {
  return row.activityFrontier
    ? { roomId: row.message.roomId, ...row.activityFrontier, action }
    : undefined;
}
