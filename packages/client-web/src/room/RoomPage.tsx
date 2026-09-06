import {
  ArrowLeft,
  Bot,
  Check,
  ClipboardCheck,
  Hash,
  MessageSquare,
  Plus,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  roomTaskWorkflowStatus,
  type RoomListItem,
  type RoomInboxItem,
  type RoomMessage,
  type RoomPrincipal,
  type RoomTaskListItem,
  type RoomTaskWorkflowStatus,
} from "@rah/runtime-protocol";

import {
  acceptRoomTask,
  acknowledgeRoomInboxItem,
  cancelRoomTask,
  createRoom,
  createRoomTask,
  postRoomMessage,
  readRoomInbox,
} from "../room-api";
import { readCompleteRoomCatalog } from "../room-catalog-projection";
import {
  RoomProjectionController,
  roomListLabel,
  type RoomProjectionState,
} from "../room-projection";
import { AgentAvatar } from "../room-ui/AgentAvatar";
import { setVisibleRoomNotificationTarget } from "../browser-notifications";
import { NeoButton, NeoEmptyState, NeoTabs } from "../room-ui/NeoPrimitives";
import { RoomIntentKeys } from "./room-intent-keys";
import "../room-ui/room-neo.css";

type RoomTab = "chat" | "tasks" | "members";
type MobileView = "directory" | "room";

function readRoomDeepLink(): {
  tab: RoomTab;
  roomId: string | null;
  messageId: string | null;
  taskId: string | null;
} {
  const query = new URLSearchParams(window.location.search);
  const taskId = query.get("taskId");
  const requestedTab = query.get("tab");
  const tab: RoomTab = taskId
    ? "tasks"
    : requestedTab === "tasks" || requestedTab === "members"
      ? requestedTab
      : "chat";
  return {
    tab,
    roomId: query.get("roomId"),
    messageId: query.get("messageId"),
    taskId,
  };
}

const TASK_COLUMNS: ReadonlyArray<{
  value: RoomTaskWorkflowStatus;
  label: string;
}> = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review", label: "In review" },
  { value: "done", label: "Done" },
  { value: "closed", label: "Closed" },
];

const TABS: ReadonlyArray<{ value: RoomTab; label: string; icon: ReactNode }> =
  [
    { value: "chat", label: "Chat", icon: <MessageSquare size={15} /> },
    { value: "tasks", label: "Tasks", icon: <ClipboardCheck size={15} /> },
    { value: "members", label: "Members", icon: <Users size={15} /> },
  ];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Room operation failed";
}

function principalName(principal: RoomPrincipal | undefined): string {
  return principal?.displayName ?? principal?.handle ?? "Unknown member";
}

function PrincipalMark(props: { principal: RoomPrincipal; size?: number }) {
  const size = props.size ?? 34;
  if (props.principal.kind === "agent") {
    return (
      <AgentAvatar
        {...(props.principal.avatarKey
          ? { avatarKey: props.principal.avatarKey }
          : {})}
        size={size}
        label={principalName(props.principal)}
      />
    );
  }
  const initial =
    principalName(props.principal).trim().slice(0, 1).toUpperCase() || "H";
  return (
    <span
      className="room-human-avatar"
      style={{ width: size, height: size }}
      role="img"
      aria-label={principalName(props.principal)}
    >
      {initial}
    </span>
  );
}

function usePanelResize(options: {
  initial: number;
  min: number;
  max: number;
  direction: "left" | "right";
}) {
  const [width, setWidth] = useState(options.initial);
  const start = useRef<{ pointerId: number; x: number; width: number } | null>(
    null,
  );
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { pointerId: event.pointerId, x: event.clientX, width };
    },
    [width],
  );
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = start.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const delta = event.clientX - current.x;
      const next =
        options.direction === "right"
          ? current.width + delta
          : current.width - delta;
      setWidth(Math.max(options.min, Math.min(options.max, next)));
    },
    [options.direction, options.max, options.min],
  );
  const stopResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, release: boolean) => {
      if (start.current?.pointerId !== event.pointerId) return;
      start.current = null;
      if (release && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );
  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      stopResize(event, true);
    },
    [stopResize],
  );
  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      stopResize(event, false);
    },
    [stopResize],
  );
  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      stopResize(event, false);
    },
    [stopResize],
  );
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        setWidth(options.min);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setWidth(options.max);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const boundaryDelta = event.key === "ArrowRight" ? 10 : -10;
      const widthDelta =
        options.direction === "right" ? boundaryDelta : -boundaryDelta;
      setWidth((current) =>
        Math.max(options.min, Math.min(options.max, current + widthDelta)),
      );
    },
    [options.direction, options.max, options.min],
  );
  return {
    width,
    onKeyDown,
    onLostPointerCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

function CreateRoomDialog(props: {
  open: boolean;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intents = useRef(new RoomIntentKeys()).current;
  if (!props.open) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) return;
    setPending(true);
    setError(null);
    const semanticIntent = JSON.stringify(["local-workbench", normalized]);
    const idempotencyKey = intents.key("create-room", semanticIntent);
    try {
      const slugBase = normalized
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const receipt = await createRoom({
        workspaceKey: "local-workbench",
        kind: "channel",
        slug: `${slugBase || "room"}-${idempotencyKey
          .replace(/[^a-z0-9]/giu, "")
          .slice(-10)
          .toLowerCase()}`,
        name: normalized,
        visibility: "private",
        idempotencyKey,
      });
      intents.complete("create-room", semanticIntent);
      setName("");
      props.onCreated(receipt.aggregateId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      className="room-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <form
        className="room-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-room-title"
        onSubmit={submit}
      >
        <div className="room-modal__header">
          <strong id="create-room-title">Create channel</strong>
          <NeoButton
            type="button"
            onClick={props.onClose}
            aria-label="Close create channel"
          >
            <X size={15} />
          </NeoButton>
        </div>
        <div className="room-modal__body">
          <label className="room-field">
            Name
            <input
              autoFocus
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <span>Channels are private until workspace ACL is configured.</span>
          {error ? <div className="room-error">{error}</div> : null}
        </div>
        <div className="room-modal__actions">
          <NeoButton type="button" onClick={props.onClose}>
            Cancel
          </NeoButton>
          <NeoButton
            type="submit"
            tone="pink"
            disabled={!name.trim() || pending}
          >
            {pending ? "Creating…" : "Create"}
          </NeoButton>
        </div>
      </form>
    </div>
  );
}

function CreateTaskDialog(props: {
  message: RoomMessage | null;
  state: RoomProjectionState;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intents = useRef(new RoomIntentKeys()).current;
  const agents =
    props.state.snapshot?.principals.filter(
      (principal) => principal.kind === "agent",
    ) ?? [];
  const reviewers = agents.filter((agent) => agent.principalId !== assigneeId);
  useEffect(() => {
    if (!props.message) return;
    setTitle(props.message.body.slice(0, 120));
    setAssigneeId(agents[0]?.principalId ?? "");
    setReviewerId(agents[1]?.principalId ?? "");
  }, [props.message?.messageId]);
  if (!props.message) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !title.trim() ||
      !assigneeId ||
      !reviewerId ||
      agents.length < 2 ||
      !props.state.roomId
    )
      return;
    setPending(true);
    setError(null);
    const semanticIntent = JSON.stringify([
      props.state.roomId,
      props.message!.messageId,
      title.trim(),
      assigneeId,
      reviewerId,
    ]);
    try {
      const request = intents.request(
        "create-task",
        semanticIntent,
        (idempotencyKey) => ({
          roomId: props.state.roomId!,
          sourceMessageId: props.message!.messageId,
          title: title.trim(),
          assigneeId,
          reviewerIds: [reviewerId],
          basedOnRoomSeq: props.state.observedRoomSeq,
          idempotencyKey,
        }),
      );
      await createRoomTask(request);
      intents.complete("create-task", semanticIntent);
      props.onCreated();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="room-modal-backdrop" role="presentation">
      <form
        className="room-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        onSubmit={submit}
      >
        <div className="room-modal__header">
          <strong id="create-task-title">Create task from message</strong>
          <NeoButton
            type="button"
            onClick={props.onClose}
            aria-label="Close create task"
          >
            <X size={15} />
          </NeoButton>
        </div>
        <div className="room-modal__body">
          <label className="room-field">
            Title
            <input
              autoFocus
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="room-field">
            Assignee
            <select
              value={assigneeId}
              disabled={agents.length < 2}
              onChange={(event) => {
                const next = event.target.value;
                setAssigneeId(next);
                if (reviewerId === next)
                  setReviewerId(
                    agents.find((agent) => agent.principalId !== next)
                      ?.principalId ?? "",
                  );
              }}
            >
              {agents.map((agent) => (
                <option key={agent.principalId} value={agent.principalId}>
                  {principalName(agent)}
                </option>
              ))}
            </select>
          </label>
          <label className="room-field">
            Independent reviewer
            <select
              value={reviewerId}
              onChange={(event) => setReviewerId(event.target.value)}
            >
              <option value="">Select reviewer</option>
              {reviewers.map((agent) => (
                <option key={agent.principalId} value={agent.principalId}>
                  {principalName(agent)}
                </option>
              ))}
            </select>
          </label>
          {agents.length < 2 ? (
            <span>
              At least two Agents are required: one assignee and one independent
              reviewer.
            </span>
          ) : null}
          {error ? <div className="room-error">{error}</div> : null}
        </div>
        <div className="room-modal__actions">
          <NeoButton type="button" onClick={props.onClose}>
            Cancel
          </NeoButton>
          <NeoButton
            type="submit"
            tone="pink"
            disabled={
              !title.trim() ||
              !assigneeId ||
              !reviewerId ||
              agents.length < 2 ||
              pending
            }
          >
            {pending ? "Creating…" : "Create task"}
          </NeoButton>
        </div>
      </form>
    </div>
  );
}

function MemberProfile(props: {
  principal: RoomPrincipal;
  role?: string | undefined;
  width: number;
  onClose: () => void;
}) {
  return (
    <aside
      className="room-profile"
      style={{ "--room-profile-width": `${props.width}px` } as CSSProperties}
      aria-label={`${principalName(props.principal)} profile`}
    >
      <div className="room-profile__header">
        <PrincipalMark principal={props.principal} size={38} />
        <div>
          <h3>{principalName(props.principal)}</h3>
          <p>@{props.principal.handle}</p>
        </div>
        <NeoButton
          type="button"
          onClick={props.onClose}
          aria-label="Close member profile"
        >
          <X size={15} />
        </NeoButton>
      </div>
      <div className="room-profile__body">
        <div className="room-profile__block">
          <div className="room-profile__label">Type</div>
          <div className="room-profile__value">{props.principal.kind}</div>
        </div>
        <div className="room-profile__block">
          <div className="room-profile__label">Room role</div>
          <div className="room-profile__value">{props.role ?? "member"}</div>
        </div>
        <div className="room-profile__block">
          <div className="room-profile__label">Identity owner</div>
          <div className="room-profile__value">Canonical Room principal</div>
        </div>
        <div className="room-profile__block">
          <div className="room-profile__label">Created</div>
          <div className="room-profile__value">
            {new Date(props.principal.createdAt).toLocaleString()}
          </div>
        </div>
      </div>
    </aside>
  );
}

function RoomTaskCard(props: {
  task: RoomTaskListItem;
  mutationPending: boolean;
  onDecision: (task: RoomTaskListItem, decision: "accept" | "cancel") => void;
}) {
  const { task } = props;
  const submission = task.currentSubmission;
  const reviews = task.currentReviewStatuses ?? [];
  const approvedReviewers = new Set(
    reviews
      .filter((review) => review.disposition === "approved")
      .map((review) => review.reviewerId),
  );
  const independentlyApproved = task.reviewerIds.every((reviewerId) =>
    approvedReviewers.has(reviewerId),
  );
  return (
    <article
      className="room-task-card"
      id={`room-task-${task.taskId}`}
      data-room-task-id={task.taskId}
      tabIndex={-1}
    >
      <h4>
        #{task.taskNumber} {task.title}
      </h4>
      {task.description ? <p>{task.description}</p> : null}
      {submission ? (
        <details className="room-task-delivery">
          <summary>
            Delivery #{submission.submissionNumber} · {approvedReviewers.size}/
            {task.reviewerIds.length} reviewed
          </summary>
          <div className="room-task-delivery__detail">
            <p>{submission.summary}</p>
            <dl>
              <div>
                <dt>Revision</dt>
                <dd>
                  {submission.evidence.baseRevision} →{" "}
                  {submission.evidence.headRevision}
                </dd>
              </div>
              <div>
                <dt>Patch</dt>
                <dd>{submission.evidence.patchDigest}</dd>
              </div>
              <div>
                <dt>Verification</dt>
                <dd>{submission.evidence.verificationDigest}</dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>
                  {new Date(submission.evidence.observedAt).toLocaleString()}
                </dd>
              </div>
            </dl>
            <div className="room-task-reviews">
              {task.reviewerIds.map((reviewerId) => {
                const review = reviews.find(
                  (candidate) => candidate.reviewerId === reviewerId,
                );
                return (
                  <div key={reviewerId}>
                    <span>{reviewerId}</span>
                    <strong>{review?.disposition ?? "pending"}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      ) : (
        <p>{task.submissionSummary ?? `Canonical state: ${task.state}`}</p>
      )}
      <div className="room-task-card__actions">
        {task.state === "submitted" ? (
          <NeoButton
            type="button"
            tone="yellow"
            disabled={
              props.mutationPending || !submission || !independentlyApproved
            }
            onClick={() => props.onDecision(task, "accept")}
          >
            <Check size={13} />{" "}
            {independentlyApproved ? "Accept" : "Awaiting review"}
          </NeoButton>
        ) : null}
        {task.state !== "completed" && task.state !== "cancelled" ? (
          <NeoButton
            type="button"
            disabled={props.mutationPending}
            onClick={() => props.onDecision(task, "cancel")}
          >
            Close
          </NeoButton>
        ) : null}
      </div>
    </article>
  );
}

export function RoomPage() {
  const deepLink = useRef(readRoomDeepLink()).current;
  const projection = useMemo(() => new RoomProjectionController(), []);
  const [state, setState] = useState(() => projection.state());
  const [catalog, setCatalog] = useState<readonly RoomListItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<RoomTab>(deepLink.tab);
  const [mobileView, setMobileView] = useState<MobileView>("directory");
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [taskMessage, setTaskMessage] = useState<RoomMessage | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<RoomMessage | null>(null);
  const [draft, setDraft] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [documentVisibility, setDocumentVisibility] =
    useState<DocumentVisibilityState>(() => document.visibilityState);
  const [documentFocused, setDocumentFocused] = useState(() =>
    document.hasFocus(),
  );
  const [chatAtLatestEdge, setChatAtLatestEdge] = useState(true);
  const [presentedTaskIds, setPresentedTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const roomScrollRef = useRef<HTMLDivElement | null>(null);
  const taskScrollRef = useRef<HTMLDivElement | null>(null);
  const roomScrollHistory = useRef<{
    roomId: string | null;
    messageCount: number;
  }>({
    roomId: null,
    messageCount: 0,
  });
  const pendingRoomScroll = useRef<
    | { kind: "anchor"; previousHeight: number; previousTop: number }
    | { kind: "latest" }
    | null
  >(null);
  const acknowledgementInFlight = useRef(new Set<string>());
  const deepLinkPaging = useRef(false);
  const deepLinkPageCount = useRef(0);
  const deepLinkFinished = useRef(false);
  const intents = useRef(new RoomIntentKeys()).current;
  const directoryResize = usePanelResize({
    initial: 320,
    min: 240,
    max: 480,
    direction: "right",
  });
  const profileResize = usePanelResize({
    initial: 380,
    min: 300,
    max: 640,
    direction: "left",
  });

  const refreshCatalog = useCallback(
    async (selectRoomId?: string) => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const items = await readCompleteRoomCatalog();
        setCatalog(items);
        const requestedRoomId = new URLSearchParams(window.location.search).get(
          "roomId",
        );
        const deepLinkedRoomId = items.some(
          (item) => item.room.roomId === requestedRoomId,
        )
          ? (requestedRoomId ?? undefined)
          : undefined;
        const nextRoomId =
          selectRoomId ??
          projection.state().roomId ??
          deepLinkedRoomId ??
          items[0]?.room.roomId;
        if (nextRoomId && nextRoomId !== projection.state().roomId)
          await projection.open(nextRoomId);
      } catch (error) {
        setCatalogError(errorText(error));
      } finally {
        setCatalogLoading(false);
      }
    },
    [projection],
  );

  useEffect(() => projection.subscribe(setState), [projection]);
  useLayoutEffect(() => {
    const pending = pendingRoomScroll.current;
    const scroll = roomScrollRef.current;
    if (!pending || !scroll) return;
    pendingRoomScroll.current = null;
    if (pending.kind === "latest") {
      scroll.scrollTop = scroll.scrollHeight;
      setChatAtLatestEdge(true);
      return;
    }
    scroll.scrollTop =
      pending.previousTop + (scroll.scrollHeight - pending.previousHeight);
  });
  useLayoutEffect(() => {
    if (tab !== "chat" || state.status !== "ready" || !state.roomId) return;
    const scroll = roomScrollRef.current;
    if (!scroll) return;
    const previous = roomScrollHistory.current;
    const roomChanged = previous.roomId !== state.roomId;
    const appended =
      !roomChanged && state.messages.length > previous.messageCount;
    if (
      !state.viewingOlderMessages &&
      (roomChanged || (appended && chatAtLatestEdge))
    ) {
      scroll.scrollTop = scroll.scrollHeight;
      setChatAtLatestEdge(true);
    }
    roomScrollHistory.current = {
      roomId: state.roomId,
      messageCount: state.messages.length,
    };
  }, [
    chatAtLatestEdge,
    state.messages.length,
    state.roomId,
    state.status,
    state.viewingOlderMessages,
    tab,
  ]);
  useEffect(() => {
    const update = () => setDocumentVisibility(document.visibilityState);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const focused = () => setDocumentFocused(true);
    const blurred = () => setDocumentFocused(false);
    window.addEventListener("focus", focused);
    window.addEventListener("blur", blurred);
    return () => {
      window.removeEventListener("focus", focused);
      window.removeEventListener("blur", blurred);
    };
  }, []);
  useEffect(() => {
    void refreshCatalog();
    return () => projection.close();
  }, [projection, refreshCatalog]);
  useEffect(() => {
    if (!state.roomId || state.status !== "ready") return;
    const timer = window.setInterval(() => void projection.sync(), 2_500);
    return () => window.clearInterval(timer);
  }, [projection, state.roomId, state.status]);
  useLayoutEffect(() => {
    if (
      deepLinkFinished.current ||
      state.status !== "ready" ||
      state.roomId !== deepLink.roomId
    )
      return;
    const targetId = deepLink.taskId ?? deepLink.messageId;
    if (!targetId) {
      deepLinkFinished.current = true;
      return;
    }
    const found = deepLink.taskId
      ? state.tasks.some((task) => task.taskId === targetId)
      : state.messages.some((message) => message.messageId === targetId);
    if (found) {
      const element = document.getElementById(
        deepLink.taskId ? `room-task-${targetId}` : `room-message-${targetId}`,
      );
      if (element) {
        element.scrollIntoView({ block: "center" });
        element.focus({ preventScroll: true });
        deepLinkFinished.current = true;
      }
      return;
    }
    const hasOlder = deepLink.taskId
      ? state.hasOlderTasks
      : state.hasOlderMessages;
    if (
      !hasOlder ||
      deepLinkPaging.current ||
      deepLinkPageCount.current >= 20
    ) {
      if (!hasOlder) deepLinkFinished.current = true;
      return;
    }
    deepLinkPaging.current = true;
    deepLinkPageCount.current += 1;
    const load = deepLink.taskId
      ? projection.loadOlderTasks()
      : projection.loadOlder();
    void load.finally(() => {
      deepLinkPaging.current = false;
    });
  }, [deepLink, projection, state]);
  useEffect(() => {
    setProfileId(null);
    setReplyTo(null);
    setOperationError(null);
  }, [state.roomId]);
  useEffect(() => {
    if (!state.roomId || state.status !== "ready") {
      setVisibleRoomNotificationTarget(null);
      return () => setVisibleRoomNotificationTarget(null);
    }
    setVisibleRoomNotificationTarget({
      roomId: state.roomId,
      tab,
      latest: tab === "chat" && !state.viewingOlderMessages && chatAtLatestEdge,
      entities:
        tab === "chat"
          ? state.messages.map((message) => ({
              type: "message" as const,
              id: message.messageId,
            }))
          : tab === "tasks"
            ? state.tasks
                .filter((task) => presentedTaskIds.has(task.taskId))
                .map((task) => ({
                type: "task" as const,
                id: task.taskId,
                }))
            : [],
    });
    return () => setVisibleRoomNotificationTarget(null);
  }, [
    chatAtLatestEdge,
    state.messages,
    state.roomId,
    state.status,
    state.tasks,
    state.viewingOlderMessages,
    tab,
    presentedTaskIds,
  ]);
  useEffect(() => {
    setPresentedTaskIds(new Set());
    if (
      tab !== "tasks" ||
      state.status !== "ready" ||
      !state.roomId ||
      !taskScrollRef.current ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const root = taskScrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        setPresentedTaskIds((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const taskId = (entry.target as HTMLElement).dataset.roomTaskId;
            if (!taskId) continue;
            if (
              entry.isIntersecting &&
              entry.intersectionRatio >= 0.5 &&
              entry.intersectionRect.width > 0 &&
              entry.intersectionRect.height > 0
            ) {
              next.add(taskId);
            } else {
              next.delete(taskId);
            }
          }
          if (
            next.size === previous.size &&
            [...next].every((taskId) => previous.has(taskId))
          ) {
            return previous;
          }
          return next;
        });
      },
      { root, threshold: 0.5 },
    );
    for (const card of root.querySelectorAll<HTMLElement>(
      "[data-room-task-id]",
    )) {
      observer.observe(card);
    }
    return () => observer.disconnect();
  }, [state.roomId, state.status, state.tasks, tab]);
  useEffect(() => {
    if (
      documentVisibility !== "visible" ||
      !documentFocused ||
      !state.roomId ||
      state.status !== "ready" ||
      state.observedRoomSeq !== state.canonicalHeadSeq ||
      (tab === "chat" && !chatAtLatestEdge) ||
      (tab === "chat" && state.viewingOlderMessages) ||
      tab === "members"
    )
      return;
    const roomId = state.roomId;
    const visibleMessages = new Set(
      state.messages.map((message) => message.messageId),
    );
    const isPresented = (item: RoomInboxItem) =>
      tab === "chat"
        ? item.aggregateType === "message" &&
          visibleMessages.has(item.aggregateId)
        : typeof item.taskId === "string" &&
          presentedTaskIds.has(item.taskId);
    let cancelled = false;
    const messageIds =
      tab === "chat"
        ? state.messages.slice(-500).map((message) => message.messageId)
        : [];
    const taskIds = tab === "tasks" ? [...presentedTaskIds].slice(-500) : [];
    if (messageIds.length === 0 && taskIds.length === 0) return;
    void readRoomInbox({
      roomId,
      pendingOnly: true,
      ...(messageIds.length > 0 ? { messageIds } : {}),
      ...(taskIds.length > 0 ? { taskIds } : {}),
      limit: 500,
    })
      .then(async (response) => {
        if (cancelled) return;
        const presented = response.items.filter(
          (item) => item.eventSeq <= state.observedRoomSeq && isPresented(item),
        );
        let acknowledged = false;
        for (const item of presented) {
          const key = `${item.inboxItemId}:${item.eventId}`;
          if (acknowledgementInFlight.current.has(key)) continue;
          acknowledgementInFlight.current.add(key);
          const semanticIntent = JSON.stringify([
            roomId,
            item.inboxItemId,
            item.eventId,
          ]);
          try {
            const request = intents.request(
              "ack-inbox",
              semanticIntent,
              (idempotencyKey) => ({
                roomId,
                inboxItemId: item.inboxItemId,
                eventId: item.eventId,
                basedOnRoomSeq: state.observedRoomSeq,
                idempotencyKey,
              }),
            );
            await acknowledgeRoomInboxItem(request);
            intents.complete("ack-inbox", semanticIntent);
            acknowledged = true;
          } finally {
            acknowledgementInFlight.current.delete(key);
          }
        }
        if (acknowledged && !cancelled) {
          await projection.sync();
          await refreshCatalog();
        }
      })
      .catch(() => {
        if (!cancelled) void projection.sync();
      });
    return () => {
      cancelled = true;
    };
  }, [
    chatAtLatestEdge,
    documentFocused,
    documentVisibility,
    intents,
    projection,
    refreshCatalog,
    state,
    tab,
    presentedTaskIds,
  ]);

  const selectedCatalogItem = catalog.find(
    (item) => item.room.roomId === state.roomId,
  );
  const principals = new Map(
    state.snapshot?.principals.map((principal) => [
      principal.principalId,
      principal,
    ]) ?? [],
  );
  const memberships = new Map(
    state.snapshot?.memberships.map((membership) => [
      membership.principalId,
      membership,
    ]) ?? [],
  );
  const profile = profileId ? principals.get(profileId) : undefined;
  const visibleRooms = catalog.filter((item) =>
    roomListLabel(item).toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const selectRoom = async (roomId: string) => {
    if (roomId !== state.roomId) await projection.open(roomId);
    const url = new URL(window.location.href);
    url.searchParams.set("surface", "room");
    url.searchParams.set("roomId", roomId);
    window.history.replaceState(null, "", url);
    setMobileView("room");
  };

  const loadOlderMessages = async () => {
    const scroll = roomScrollRef.current;
    pendingRoomScroll.current = {
      kind: "anchor",
      previousHeight: scroll?.scrollHeight ?? 0,
      previousTop: scroll?.scrollTop ?? 0,
    };
    await projection.loadOlder();
  };

  const returnToLatestMessages = () => {
    pendingRoomScroll.current = { kind: "latest" };
    projection.returnToLatest();
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!state.roomId || !draft.trim() || mutationPending) return;
    const body = draft.trim();
    const semanticIntent = JSON.stringify([
      state.roomId,
      body,
      replyTo?.messageId ?? null,
    ]);
    setMutationPending(true);
    setOperationError(null);
    try {
      await postRoomMessage({
        roomId: state.roomId,
        body,
        ...(replyTo ? { replyToMessageId: replyTo.messageId } : {}),
        idempotencyKey: intents.key("post-message", semanticIntent),
      });
      intents.complete("post-message", semanticIntent);
      setDraft("");
      setReplyTo(null);
      await projection.sync();
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setMutationPending(false);
    }
  };

  const decideTask = async (
    task: RoomTaskListItem,
    decision: "accept" | "cancel",
  ) => {
    const semanticIntent = JSON.stringify([task.roomId, task.taskId, decision]);
    setMutationPending(true);
    setOperationError(null);
    try {
      if (decision === "accept") {
        const request = intents.request(
          "decide-task",
          semanticIntent,
          (idempotencyKey) => ({
            roomId: task.roomId,
            taskId: task.taskId,
            basedOnRoomSeq: state.observedRoomSeq,
            summary: "Accepted by Room owner",
            idempotencyKey,
          }),
        );
        await acceptRoomTask(request);
      } else {
        const request = intents.request(
          "decide-task",
          semanticIntent,
          (idempotencyKey) => ({
            roomId: task.roomId,
            taskId: task.taskId,
            basedOnRoomSeq: state.observedRoomSeq,
            reason: "Closed by Room owner",
            idempotencyKey,
          }),
        );
        await cancelRoomTask(request);
      }
      intents.complete("decide-task", semanticIntent);
      await projection.sync();
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setMutationPending(false);
    }
  };

  return (
    <div
      className="room-page"
      data-mobile-view={mobileView}
      data-room-contract="neo-brutalist-v1"
    >
      <aside
        className="room-directory"
        style={
          {
            "--room-directory-width": `${directoryResize.width}px`,
          } as CSSProperties
        }
      >
        <div className="room-directory__header">
          <h1 className="room-directory__title">Rooms</h1>
          <NeoButton
            type="button"
            tone="yellow"
            onClick={() => setCreateRoomOpen(true)}
            aria-label="Create channel"
          >
            <Plus size={16} />
          </NeoButton>
        </div>
        <label className="room-directory__search">
          <Search size={15} aria-hidden="true" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search channels and DMs"
            aria-label="Search channels and direct messages"
          />
        </label>
        <div className="room-directory__list">
          {catalogLoading && catalog.length === 0 ? (
            <div className="room-directory__section">Loading…</div>
          ) : null}
          {catalogError ? (
            <div className="room-error">
              {catalogError}
              <NeoButton onClick={() => void refreshCatalog()}>Retry</NeoButton>
            </div>
          ) : null}
          {(["channel", "direct"] as const).map((kind) => {
            const items = visibleRooms.filter(
              (item) => item.room.kind === kind,
            );
            if (items.length === 0) return null;
            return (
              <section key={kind}>
                <div className="room-directory__section">
                  {kind === "channel" ? "Channels" : "Direct messages"} ·{" "}
                  {items.length}
                </div>
                {items.map((item) => (
                  <button
                    key={item.room.roomId}
                    className="room-directory__item"
                    type="button"
                    aria-current={
                      state.roomId === item.room.roomId ? "page" : undefined
                    }
                    onClick={() => void selectRoom(item.room.roomId)}
                  >
                    {item.room.kind === "channel" ? (
                      <Hash size={17} />
                    ) : item.directPeer ? (
                      <PrincipalMark principal={item.directPeer} size={20} />
                    ) : (
                      <Bot size={17} />
                    )}
                    <span className="room-directory__item-label">
                      {roomListLabel(item)}
                    </span>
                    {item.pendingAttentionCount > 0 ? (
                      <span className="room-directory__badge">
                        {item.pendingAttentionCount}
                      </span>
                    ) : null}
                  </button>
                ))}
              </section>
            );
          })}
          {!catalogLoading && !catalogError && visibleRooms.length === 0 ? (
            <NeoEmptyState
              icon={<MessageSquare size={30} />}
              title="No Rooms"
              description="Create a channel to start working together."
            />
          ) : null}
        </div>
      </aside>
      <div
        className="room-directory-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Room directory"
        aria-valuemin={240}
        aria-valuemax={480}
        aria-valuenow={Math.round(directoryResize.width)}
        tabIndex={0}
        onKeyDown={directoryResize.onKeyDown}
        onPointerDown={directoryResize.onPointerDown}
        onPointerMove={directoryResize.onPointerMove}
        onPointerUp={directoryResize.onPointerUp}
        onPointerCancel={directoryResize.onPointerCancel}
        onLostPointerCapture={directoryResize.onLostPointerCapture}
      />

      <main className="room-main">
        <header className="room-page__header">
          <div className="room-page__identity">
            <NeoButton
              className="room-mobile-back"
              type="button"
              onClick={() => setMobileView("directory")}
              aria-label="Back to Rooms"
            >
              <ArrowLeft size={15} />
            </NeoButton>
            <span className="room-page__identity-mark" aria-hidden="true">
              {selectedCatalogItem?.room.kind === "direct" ? (
                <MessageSquare size={20} />
              ) : (
                <Hash size={22} />
              )}
            </span>
            <div className="room-page__identity-text">
              <h2>
                {selectedCatalogItem
                  ? roomListLabel(selectedCatalogItem)
                  : "Rooms"}
              </h2>
              <p>
                {selectedCatalogItem
                  ? `${selectedCatalogItem.participantCount} members · ${selectedCatalogItem.room.visibility}`
                  : "Local canonical collaboration"}
              </p>
            </div>
          </div>
          {state.syncing ? (
            <span className="room-page__sync">Syncing…</span>
          ) : null}
        </header>
        <NeoTabs
          value={tab}
          items={TABS}
          onChange={setTab}
          label="Room sections"
        />
        <div className="room-content">
          {operationError || state.error ? (
            <div className="room-error" role="alert">
              <span>{operationError ?? state.error}</span>
              <NeoButton
                onClick={() => {
                  setOperationError(null);
                  void projection.sync();
                }}
              >
                Reconnect
              </NeoButton>
            </div>
          ) : null}
          {state.status === "loading" ? (
            <NeoEmptyState
              icon={<MessageSquare size={34} />}
              title="Loading Room"
              description="Reading the latest bounded window…"
            />
          ) : null}
          {state.status === "ready" && tab === "chat" ? (
            <>
              <div
                className="room-scroll"
                ref={roomScrollRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  setChatAtLatestEdge(
                    target.scrollHeight -
                      target.scrollTop -
                      target.clientHeight <=
                      8,
                  );
                }}
              >
                {state.messages.length === 0 ? (
                  <NeoEmptyState
                    icon={<MessageSquare size={34} />}
                    title="No messages"
                    description="Start the conversation."
                  />
                ) : (
                  <div className="room-message-list">
                    <div className="room-history-controls">
                      {state.viewingOlderMessages ? (
                        <NeoButton
                          type="button"
                          tone="yellow"
                          onClick={returnToLatestMessages}
                        >
                          Return to latest messages
                        </NeoButton>
                      ) : null}
                      {state.hasOlderMessages ? (
                        <NeoButton
                          type="button"
                          onClick={() => void loadOlderMessages()}
                        >
                          Load earlier messages
                        </NeoButton>
                      ) : null}
                    </div>
                    {state.messages.map((message) => {
                      const actor = principals.get(message.actorId);
                      if (!actor) return null;
                      return (
                        <article
                          className="room-message"
                          key={message.messageId}
                          id={`room-message-${message.messageId}`}
                          tabIndex={-1}
                        >
                          <button
                            className="room-message__avatar-button"
                            type="button"
                            onClick={() => setProfileId(actor.principalId)}
                            aria-label={`Open ${principalName(actor)} profile`}
                          >
                            <PrincipalMark principal={actor} size={34} />
                          </button>
                          <div className="room-message__body">
                            <div className="room-message__meta">
                              <span className="room-message__name">
                                {principalName(actor)}
                              </span>
                              <time
                                className="room-message__time"
                                dateTime={message.createdAt}
                              >
                                {new Date(message.createdAt).toLocaleTimeString(
                                  [],
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
                              </time>
                            </div>
                            <div className="room-message__text">
                              {message.body}
                            </div>
                            <div className="room-message__actions">
                              <button
                                className="room-inline-action"
                                type="button"
                                onClick={() => setReplyTo(message)}
                              >
                                Reply
                              </button>
                              {!message.replyToMessageId ? (
                                <button
                                  className="room-inline-action"
                                  type="button"
                                  onClick={() => setTaskMessage(message)}
                                >
                                  Create task
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
              <form className="room-composer" onSubmit={sendMessage}>
                {replyTo ? (
                  <div className="room-composer__reply">
                    Replying to {principalName(principals.get(replyTo.actorId))}
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      aria-label="Cancel reply"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : null}
                <div className="room-composer__box">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={replyTo ? "Write a reply…" : "Send a message…"}
                    aria-label="Room message"
                  />
                  <NeoButton
                    type="submit"
                    tone="pink"
                    disabled={!draft.trim() || mutationPending}
                    aria-label="Send message"
                  >
                    <Send size={16} />
                  </NeoButton>
                </div>
              </form>
            </>
          ) : null}
          {state.status === "ready" && tab === "tasks" ? (
            <div className="room-scroll" ref={taskScrollRef}>
              {state.viewingOlderTasks ? (
                <NeoButton
                  className="room-load-older"
                  type="button"
                  onClick={() => projection.returnToLatestTasks()}
                >
                  Return to latest tasks
                </NeoButton>
              ) : null}
              {state.hasOlderTasks ? (
                <NeoButton
                  className="room-load-older"
                  type="button"
                  onClick={() => void projection.loadOlderTasks()}
                >
                  Load earlier tasks
                </NeoButton>
              ) : null}
              <div className="room-task-board">
                {TASK_COLUMNS.map((column) => {
                  const tasks = state.tasks.filter(
                    (task) =>
                      roomTaskWorkflowStatus(task.state) === column.value,
                  );
                  return (
                    <section className="room-task-column" key={column.value}>
                      <header className="room-task-column__header">
                        <span className="room-task-column__tag">
                          {column.label}
                        </span>
                        <span>{tasks.length}</span>
                      </header>
                      <div className="room-task-column__body">
                        {tasks.length === 0 ? (
                          <span>No {column.label.toLowerCase()} tasks.</span>
                        ) : (
                          tasks.map((task) => (
                            <RoomTaskCard
                              key={task.taskId}
                              task={task}
                              mutationPending={mutationPending}
                              onDecision={(target, decision) => {
                                void decideTask(target, decision);
                              }}
                            />
                          ))
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          ) : null}
          {state.status === "ready" && tab === "members" ? (
            <div className="room-scroll">
              <div className="room-members">
                {(["agent", "human", "service"] as const).map((kind) => {
                  const items =
                    state.snapshot?.principals.filter(
                      (principal) => principal.kind === kind,
                    ) ?? [];
                  if (items.length === 0) return null;
                  return (
                    <section key={kind}>
                      <h3 className="room-members__heading">
                        {kind} · {items.length}
                      </h3>
                      {items.map((principal) => (
                        <button
                          key={principal.principalId}
                          type="button"
                          className="room-member-row"
                          onClick={() => setProfileId(principal.principalId)}
                        >
                          <PrincipalMark principal={principal} size={34} />
                          <span className="room-member-row__detail">
                            <strong>{principalName(principal)}</strong>
                            <span>@{principal.handle}</span>
                          </span>
                          <span className="room-member-row__role">
                            {memberships.get(principal.principalId)?.role ??
                              "member"}
                          </span>
                        </button>
                      ))}
                    </section>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {profile ? (
        <>
          <div
            className="room-profile-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize member profile"
            aria-valuemin={300}
            aria-valuemax={640}
            aria-valuenow={Math.round(profileResize.width)}
            tabIndex={0}
            onKeyDown={profileResize.onKeyDown}
            onPointerDown={profileResize.onPointerDown}
            onPointerMove={profileResize.onPointerMove}
            onPointerUp={profileResize.onPointerUp}
            onPointerCancel={profileResize.onPointerCancel}
            onLostPointerCapture={profileResize.onLostPointerCapture}
          />
          <MemberProfile
            principal={profile}
            role={memberships.get(profile.principalId)?.role}
            width={profileResize.width}
            onClose={() => setProfileId(null)}
          />
        </>
      ) : null}
      <CreateRoomDialog
        open={createRoomOpen}
        onClose={() => setCreateRoomOpen(false)}
        onCreated={(roomId) => {
          setCreateRoomOpen(false);
          void refreshCatalog(roomId).then(() => setMobileView("room"));
        }}
      />
      <CreateTaskDialog
        message={taskMessage}
        state={state}
        onClose={() => setTaskMessage(null)}
        onCreated={() => {
          setTaskMessage(null);
          setTab("tasks");
          void projection.sync();
        }}
      />
    </div>
  );
}
