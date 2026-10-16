import { useRef } from "react";
import { useLocation } from "react-router-dom";
import type { Dispatch, SetStateAction } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { loadChannelDirectory } from "./channel-client.ts";
import type { LoomPrivateBoxClient } from "./private-box.ts";
import type { SearchEntity } from "./search-entities.ts";
import type { useIntentRoute } from "./useIntentRoute.ts";
type Directory = Awaited<ReturnType<typeof loadChannelDirectory>>;
/** Search route composition only. The existing private-box WriteIntentSlot owns all writes and unknown-result recovery. */
export function useSearchDestination(
  client: RahClient,
  boxes: LoomPrivateBoxClient | undefined,
  onDirectory: Dispatch<SetStateAction<Directory | undefined>>,
  setParams: ReturnType<typeof useIntentRoute>[1],
) {
  const location = useLocation(),
    current = useRef(location),
    serial = useRef(0);
  current.current = location;
  return async (entity: SearchEntity, full: boolean) => {
    if (hasUnresolvedIntents()) throw Error("仍有未决操作");
    const started = current.current,
      ticket = ++serial.current;
    const fresh = () =>
      current.current === started && serial.current === ticket;
    const navigate = (roomId: string) => {
      if (!fresh() || hasUnresolvedIntents()) return;
      const next = full
        ? new URLSearchParams()
        : new URLSearchParams(started.search);
      for (const key of ["message", "thread", "detail", "chat"])
        next.delete(key);
      next.set("room", roomId);
      setParams(next, { state: null });
    };
    const directory = await loadChannelDirectory(client);
    if (!fresh() || hasUnresolvedIntents()) return;
    if (entity.type === "channel") {
      const room = [...directory.channels, ...directory.archivedChannels].find(
        (r) => r.roomId === entity.channelId,
      );
      if (!room) throw Error("频道不可用");
      onDirectory(directory);
      navigate(room.roomId);
      return;
    }
    if (entity.type !== "agentDm" || !entity.agentId || !boxes)
      throw Error("实例不可用");
    const existing = directory.privateBoxes.find(
      (r) => r.instancePrivateBox?.instanceId === entity.agentId,
    );
    if (existing) {
      onDirectory(directory);
      navigate(existing.roomId);
      return;
    }
    // Direct-open authorizes the live instance again and returns the canonical private box.
    const outcome = await boxes.open(entity.agentId, (result) => {
      if (result.kind !== "ok") return;
      const room = result.result.room;
      onDirectory((previous) =>
        previous
          ? {
              ...previous,
              privateBoxes: [
                ...previous.privateBoxes.filter(
                  (r) => r.roomId !== room.roomId,
                ),
                room,
              ],
            }
          : previous,
      );
      navigate(room.roomId);
    });
    if (outcome.kind === "rejected" || outcome.kind === "busy")
      throw Error("打开私聊被拒绝");
  };
}
