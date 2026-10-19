import { useEffect, useState } from "react";
import { Button, Spinner } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import type { Room } from "@rah-os/protocol";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import {
  ChannelMemberListShell,
  ChannelMemberRow,
} from "../packages/web/src/components/channel/ChannelMemberList.tsx";
import { useIntentRoute } from "./useIntentRoute.ts";
import { uiActionProps } from "./ui-action-props.ts";
/** Read-only directory entry: includes removed instances, never reopens/creates a box. */
export default function ChannelPrivateHistory({
  client,
  channel,
  onOpen,
}: {
  client: RahClient;
  channel: Room;
  onOpen: () => void;
}) {
  const [, setParams] = useIntentRoute();
  const [rooms, setRooms] = useState<Room[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setRooms(undefined);
    setError(false);
    void client
      .request(
        "room.list",
        { workspaceId: channel.workspaceId },
        { signal: abort.signal },
      )
      .then(({ rooms }) => {
        if (!abort.signal.aborted)
          setRooms(
            rooms.filter(
              (r) =>
                !r.side && r.instancePrivateBox?.channelId === channel.roomId,
            ),
          );
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [client, channel.roomId, channel.workspaceId, retry]);
  if (error)
    return (
      <Button
        {...uiActionProps.recovery}
        onClick={() => setRetry((n) => n + 1)}
      >
        重新读取私密消息
      </Button>
    );
  if (!rooms) return <Spinner aria-label="读取私密消息" />;
  if (!rooms.length) return null;
  return (
    <section className="mt-4" data-testid="channel-private-history">
      <h3 className="mb-3 text-callout font-semibold">私密消息</h3>
      <ChannelMemberListShell framed={false}>
        {rooms.map((room) => (
          <ChannelMemberRow
            key={room.roomId}
            type="agent"
            name={room.name}
            secondary={
              room.instancePrivateBox?.active
                ? "与频道共用实例会话"
                : "实例已移除 · 历史只读"
            }
            onRowClick={() => {
              if (hasUnresolvedIntents()) return;
              onOpen();
              setParams({ room: room.roomId });
            }}
          />
        ))}
      </ChannelMemberListShell>
    </section>
  );
}
