import { useEffect, useMemo, useState } from "react";
import {
  MessageSession,
  RAFT_MESSAGE_PAGE_SIZE,
  runRoomMutationAtLatest,
  type RoomSession,
} from "@rah-os/client-core";
import type { RahClient } from "@rah-os/client-sdk";
import type { NavigationTarget, Principal, Room, Task } from "@rah-os/protocol";
import { createRoomViewModel } from "@rah-os/ui-web";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { useMobileLayout } from "../use-mobile-layout.ts";
import { useDiscoveryQuery } from "../use-discovery-query.ts";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import {
  TaskDetailMetadata,
  TaskThreadPresentation,
} from "./global-task-detail.tsx";
import { ThreadPane } from "./conversation-panes.tsx";

type TaskTarget = Extract<NavigationTarget, { kind: "task" }>;
/** Chat approvals own only overlay presentation. They never navigate or focus
 * the source conversation. Canonical reads/mutations retain their shared owners. */
export function ChatTaskApproval({
  client,
  target,
  room,
  people,
  activeMemberIds,
  agents,
  principal,
  session,
  canManage,
  writeEnabled,
  canReply,
  canAttachFiles,
  canForward,
  onTaskWorkflow,
  onChanged,
  onClose,
}: {
  client: RahClient;
  target: TaskTarget;
  room: Room;
  people: readonly Principal[];
  activeMemberIds: readonly string[];
  agents: readonly WorkspaceAgentView[];
  principal: Principal | undefined;
  session: RoomSession | undefined;
  canManage: boolean;
  writeEnabled: boolean;
  canReply: boolean;
  canAttachFiles: boolean;
  canForward: boolean;
  onTaskWorkflow: (task: Task) => Promise<void>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const mobile = useMobileLayout();
  const result = useDiscoveryQuery(client, "task.get", {
    roomId: target.roomId,
    taskId: target.taskId,
  });
  const task = result.data?.task;
  const changed = () => {
    result.refresh();
    onChanged();
  };
  const metadata = (
    <TaskDetailMetadata
      client={client}
      task={task}
      people={people}
      activeMemberIds={activeMemberIds}
      principalId={principal?.principalId}
      agents={agents}
      canManage={canManage || task?.creatorId === principal?.principalId}
      writeEnabled={writeEnabled}
      onChanged={changed}
    />
  );
  return (
    <TaskThreadPresentation
      modal
      compact={mobile}
      task={task}
      roomName={room.name}
      error={result.error}
      onClose={onClose}
    >
      {mobile || !task ? (
        metadata
      ) : (
        <ChatTaskDiscussion
          key={task.taskId}
          client={client}
          task={task}
          room={room}
          people={people}
          activeMemberIds={activeMemberIds}
          agents={agents}
          principal={principal}
          session={session}
          canManage={canManage}
          canReply={canReply}
          canAttachFiles={canAttachFiles}
          canForward={canForward}
          onTaskWorkflow={onTaskWorkflow}
          onChanged={changed}
          onClose={onClose}
          metadata={metadata}
        />
      )}
    </TaskThreadPresentation>
  );
}

function ChatTaskDiscussion({
  client,
  task,
  room,
  people,
  agents,
  principal,
  session,
  canManage,
  canReply,
  canAttachFiles,
  canForward,
  onTaskWorkflow,
  onChanged,
  onClose,
  metadata,
  activeMemberIds,
}: Omit<Parameters<typeof ChatTaskApproval>[0], "target" | "writeEnabled"> & {
  task: Task;
  metadata: React.ReactNode;
}) {
  const messages = useMemo(
    () =>
      new MessageSession({
        client,
        roomId: task.roomId,
        threadId: task.threadId,
      }),
    [client, task.roomId, task.threadId],
  );
  const [state, setState] = useState(messages.state);
  const [loading, setLoading] = useState(true);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const context = useDiscoveryQuery(client, "message.context", {
    messageId: task.sourceMessageId,
  });
  useEffect(() => {
    const controller = new AbortController();
    void messages
      .syncUntilCurrent({
        limit: RAFT_MESSAGE_PAGE_SIZE,
        maxPages: 4,
        signal: controller.signal,
      })
      .then((value) => {
        if (!controller.signal.aborted) {
          setState(value);
          setError(undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "无法加载任务讨论");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const timer = window.setTimeout(() => setTick((value) => value + 1), 5000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [messages, tick]);
  const view = createRoomViewModel({
    members: people,
    messages: state.messages,
    tasks: [task],
  });
  const root = createRoomViewModel({
    members: people,
    messages: context.data
      ? [context.data.rootMessage ?? context.data.message]
      : [],
    tasks: [task],
  }).messages[0];
  async function submit(body: string, attachmentIds: string[] = []) {
    if (!canReply || !session)
      throw new Error("Room 尚未追赶到最新位置，暂不能回复");
    const idempotencyKey = attachmentIds[0]
      ? `web-thread-file-reply-${attachmentIds[0]}`
      : `web-thread-reply-${browserOpaqueId()}`;
    await runRoomMutationAtLatest({
      session,
      mutate: (basedOnRoomSeq) =>
        client.request("thread.reply", {
          roomId: task.roomId,
          threadId: task.threadId,
          basedOnRoomSeq,
          body,
          idempotencyKey,
          recipientIds: agents
            .filter(
              (agent) =>
                agent.state === "enabled" &&
                activeMemberIds.includes(agent.participantId),
            )
            .map((agent) => agent.participantId),
          ...(attachmentIds.length ? { attachmentIds } : {}),
        }),
    });
    setTick((value) => value + 1);
    onChanged();
  }
  return (
    <ThreadPane
      client={client}
      hideHeader
      parentSlot={
        <>
          {metadata}
          {error || context.error ? (
            <p role="alert">{error ?? context.error}</p>
          ) : null}
        </>
      }
      canManageAnyTask={canManage}
      currentPrincipal={principal}
      messageAgents={agents}
      mentionAgentIds={activeMemberIds.filter((id) =>
        people.some(
          (person) => person.principalId === id && person.kind === "agent",
        ),
      )}
      canReply={canReply}
      canForward={canForward}
      canAttachFiles={canAttachFiles}
      loading={loading}
      hasEarlierReplies={state.hasEarlier}
      earlierRepliesLoading={earlierLoading}
      onLoadEarlier={async () => {
        setEarlierLoading(true);
        try {
          setState(
            await messages.loadEarlier({ limit: RAFT_MESSAGE_PAGE_SIZE }),
          );
        } finally {
          setEarlierLoading(false);
        }
      }}
      onClose={onClose}
      onSubmit={submit}
      onTaskWorkflow={onTaskWorkflow}
      replies={view.messages}
      roomMembers={people}
      roomId={room.roomId}
      roomKind={room.kind}
      roomName={room.name}
      root={root}
      task={task}
      referenceTasks={[task]}
      threadId={task.threadId}
    />
  );
}
