import type { RahClient } from "@rah-os/client-sdk";
import { ThreadActivityClient } from "./thread-activity.ts";
export async function prepareActivityMute(
  client: RahClient,
  workspaceId: string,
  roomId: string,
  muted: boolean,
  expectedVersion?: number,
) {
  const { preferences } = await client.request("sidebar.get", { workspaceId });
  if (expectedVersion !== undefined && preferences.version !== expectedVersion)
    throw Error("偏好已变化，未覆盖新的设置。");
  const key = `room:${roomId}`;
  if (preferences.mutedActivity.includes(key) === muted) return undefined;
  return {
    expectedVersion: preferences.version,
    patch: {
      mutedActivity: muted
        ? [...preferences.mutedActivity, key]
        : preferences.mutedActivity.filter((x) => x !== key),
    },
  };
}
export async function changeActivityFollow(
  client: RahClient,
  roomId: string,
  threadId: string,
  following: boolean,
  throughSeq: number,
  canContinue: () => boolean = () => true,
) {
  const activity = new ThreadActivityClient(client, roomId, threadId);
  await activity.refresh();
  if (!canContinue()) return false;
  if (activity.following === following) return false;
  await activity.follow(following, throughSeq);
  if (activity.following !== following)
    throw Error("未确认关注状态已更新；不会自动重发。");
  return true;
}
