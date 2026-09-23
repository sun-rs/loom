import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  MessageSession,
  RoomSession,
  runRoomMutationAtLatest,
} from "@rah-os/client-core";
import type { Principal, Room } from "@rah-os/protocol";
import { createRoomViewModel, type WorkspaceAgentView } from "@rah-os/ui-web";
import { ChatPane } from "./conversation-panes.tsx";

/** The private box is a canonical Room, rendered in the existing inspector.
 * Message paging, drafts, scrolling and mutation barriers retain their owners. */
export function InstancePrivateChat({
  client,
  room,
  agent,
  human,
}: {
  client: RahClient;
  room: Room;
  agent: WorkspaceAgentView;
  human: Principal | undefined;
}) {
  const session = useMemo(
    () =>
      new RoomSession({
        client,
        roomId: room.roomId,
        consumerId: `web-private-${crypto.randomUUID()}`,
      }),
    [client, room.roomId],
  );
  const messages = useMemo(
    () => new MessageSession({ client, roomId: room.roomId }),
    [client, room.roomId],
  );
  const [state, setState] = useState(messages.state);
  const [members, setMembers] = useState<Principal[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const alive = useRef(false);
  const tail = useRef(Promise.resolve());
  const refresh = useCallback(
    (earlier = false) => {
      const work = tail.current.then(async () => {
        const synced = await session.syncUntilCurrent();
        if (earlier) await messages.loadEarlier();
        else await messages.syncUntilCurrent();
        if (!alive.current) return;
        setState(messages.state);
        setMembers([...(synced.state.snapshot?.members ?? [])]);
        setReady(synced.caughtUp && messages.state.complete);
        setError(undefined);
      });
      tail.current = work.catch(() => undefined);
      return work;
    },
    [session, messages],
  );
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      try {
        await refresh();
      } catch (e) {
        if (alive.current) {
          setError(String(e));
          setReady(false);
        }
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      cancelled = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  const view = createRoomViewModel({
    members,
    messages: state.messages,
    tasks: [],
  });
  return (
    <>
      <p className="rah-inline-help" role="note">
        私聊 · 与频道共用此实例，忙时排队。
      </p>
      {error && <p role="alert">{error}</p>}
      <ChatPane
        client={client}
        currentPrincipal={human}
        agents={[agent]}
        messageAgents={[agent]}
        canManageAnyTask={false}
        canCreateTask={false}
        canForward={false}
        canPost={ready}
        canReadThreads={false}
        canWriteThreads={false}
        earlierMessagesLoading={false}
        hasEarlierMessages={state.hasEarlier}
        loading={!ready && state.messages.length === 0 && !error}
        messages={view.messages}
        roomEvents={[]}
        roomMembers={members}
        roomId={room.roomId}
        roomKind="direct"
        roomName={agent.displayName}
        tasks={[]}
        threads={[]}
        threadReplyPreviews={[]}
        onManageAgents={() => {}}
        onConvertToTask={async () => {}}
        onTaskWorkflow={async () => {}}
        onLoadEarlier={() => refresh(true)}
        onOpenThread={async () => {}}
        onSubmit={async (body) => {
          const idempotencyKey = `private-${crypto.randomUUID()}`;
          await runRoomMutationAtLatest({
            session,
            mutate: (basedOnRoomSeq) =>
              client.request("message.post", {
                roomId: room.roomId,
                body,
                basedOnRoomSeq,
                idempotencyKey,
                recipients: [
                  { participantId: agent.participantId, reason: "mention" },
                ],
              }),
          });
          // The post is already committed; a failed refresh must not turn it
          // into a failed send and invite a duplicate submission.
          try {
            await refresh();
          } catch (e) {
            if (alive.current) {
              setError(String(e));
              setReady(false);
            }
          }
        }}
      />
    </>
  );
}
