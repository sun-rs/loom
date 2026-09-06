import { useCallback, useEffect, useState } from "react";
import type { CouncilMessagePart, RahEvent, RoomInboxItem, SessionSummary } from "@rah/runtime-protocol";
import { providerLabel } from "./types";

const NOTIFICATIONS_ENABLED_KEY = "rah-browser-notifications-enabled";
const NOTIFICATIONS_SETTINGS_EVENT = "rah:browser-notifications-settings-updated";
const NOTIFICATION_SERVICE_WORKER_URL = "/rah-notification-sw.js";
const MAX_NOTIFIED_KEYS = 500;

export type NotificationTarget = {
  kind: "session" | "council" | "room";
  id: string;
};

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export type RahNotificationCandidate = {
  key: string;
  target: NotificationTarget;
  title: string;
  body: string;
  url: string;
};

export type VisibleRoomNotificationTarget = {
  roomId: string;
  tab: "chat" | "tasks" | "members";
  /** True only while the bounded latest Chat window is mounted. */
  latest: boolean;
  /** Exact canonical entities mounted in the active Room surface. */
  entities: ReadonlyArray<{
    type: "message" | "task";
    id: string;
  }>;
};

type NotificationEnvironment = {
  activeTargets: readonly NotificationTarget[];
  documentVisible: boolean;
  documentFocused: boolean;
};

let visibleNotificationTargets: NotificationTarget[] = [];
let visibleRoomNotificationTarget: VisibleRoomNotificationTarget | null = null;
let notificationWorkerPromise: Promise<ServiceWorkerRegistration | null> | null = null;
const notifiedKeys = new Set<string>();
const notifiedKeyOrder: string[] = [];

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function readBoolean(key: string, defaultValue: boolean): boolean {
  if (!isBrowser()) {
    return defaultValue;
  }
  try {
    const value = localStorage.getItem(key);
    if (value === null) {
      return defaultValue;
    }
    return value === "true";
  } catch {
    return defaultValue;
  }
}

function writeBoolean(key: string, value: boolean): void {
  if (!isBrowser()) {
    return;
  }
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore storage failures
  }
}

function dispatchNotificationSettingsEvent(): void {
  if (!isBrowser()) {
    return;
  }
  window.dispatchEvent(new Event(NOTIFICATIONS_SETTINGS_EVENT));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function notificationTargetFromEvent(event: RahEvent): NotificationTarget {
  if (event.type === "council.message.created") {
    return { kind: "council", id: event.payload.council.id };
  }
  return { kind: "session", id: event.sessionId };
}

function providerNameForEvent(event: RahEvent, summary?: SessionSummary | null): string {
  if (summary) {
    return providerLabel(summary.session.provider);
  }
  if (event.source.provider !== "system") {
    return providerLabel(event.source.provider);
  }
  return "RAH";
}

function sessionNotificationTitle(
  event: RahEvent,
  summary: SessionSummary | null | undefined,
  fallback: string,
): string {
  const providerName = providerNameForEvent(event, summary);
  const title = summary?.session.title?.trim();
  if (!title) {
    return fallback.replace("{provider}", providerName);
  }
  return `${providerName}: ${truncate(title, 48)}`;
}

export function textFromCouncilParts(parts: readonly CouncilMessagePart[]): string {
  return collapseWhitespace(
    parts
      .map((part) => (part.kind === "text" ? part.text : ""))
      .join(""),
  );
}

export function notificationDedupKeyFromEvent(event: RahEvent): string | null {
  switch (event.type) {
    case "timeline.item.added":
    case "timeline.item.updated": {
      const item = event.payload.item;
      if (item.kind !== "assistant_message") {
        return null;
      }
      const stableItemId =
        event.payload.identity?.canonicalItemId ??
        item.messageId ??
        event.turnId ??
        event.id;
      return `session:${event.sessionId}:assistant:${stableItemId}`;
    }
    case "permission.requested":
      return `session:${event.sessionId}:permission:${event.payload.request.id}`;
    case "notification.emitted":
      return `session:${event.sessionId}:notification:${event.id}`;
    case "council.message.created":
      return `council:${event.payload.message.councilId}:message:${event.payload.message.id}`;
    default:
      return null;
  }
}

export function notificationCandidateFromEvent(
  event: RahEvent,
  summary?: SessionSummary | null,
): RahNotificationCandidate | null {
  const key = notificationDedupKeyFromEvent(event);
  if (!key) {
    return null;
  }

  if (event.type === "timeline.item.added" || event.type === "timeline.item.updated") {
    const item = event.payload.item;
    if (item.kind !== "assistant_message") {
      return null;
    }
    const body = truncate(collapseWhitespace(item.text), 220);
    if (!body) {
      return null;
    }
    return {
      key,
      target: notificationTargetFromEvent(event),
      title: sessionNotificationTitle(event, summary, "New {provider} reply"),
      body,
      url: "/",
    };
  }

  if (event.type === "permission.requested") {
    const request = event.payload.request;
    const body = truncate(collapseWhitespace(request.description ?? request.title), 220);
    return {
      key,
      target: notificationTargetFromEvent(event),
      title: sessionNotificationTitle(event, summary, "{provider} needs permission"),
      body: body || "A permission request is waiting.",
      url: "/",
    };
  }

  if (event.type === "notification.emitted") {
    if (event.payload.level === "info") {
      return null;
    }
    const body = truncate(collapseWhitespace(event.payload.body), 220);
    return {
      key,
      target: notificationTargetFromEvent(event),
      title: event.payload.title || "RAH notification",
      body: body || event.payload.level,
      url: event.payload.url ?? "/",
    };
  }

  if (event.type === "council.message.created") {
    if (event.payload.message.role !== "agent") {
      return null;
    }
    const body = truncate(textFromCouncilParts(event.payload.message.parts), 220);
    if (!body) {
      return null;
    }
    const councilTitle = event.payload.council.title.trim();
    return {
      key,
      target: notificationTargetFromEvent(event),
      title: councilTitle ? `Council: ${truncate(councilTitle, 48)}` : "New Council reply",
      body,
      url: "/",
    };
  }

  return null;
}

function targetMatches(left: NotificationTarget, right: NotificationTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function isActivelyViewingTarget(
  target: NotificationTarget,
  environment: NotificationEnvironment,
): boolean {
  if (!environment.documentVisible || !environment.documentFocused) {
    return false;
  }
  return environment.activeTargets.some((activeTarget) => targetMatches(activeTarget, target));
}

export function shouldNotifyForUnreadEvent(args: {
  event: RahEvent;
  activeTargets: readonly NotificationTarget[];
  documentVisible: boolean;
  documentFocused: boolean;
}): boolean {
  const candidate = notificationCandidateFromEvent(args.event);
  if (!candidate) {
    return false;
  }
  return !isActivelyViewingTarget(candidate.target, {
    activeTargets: args.activeTargets,
    documentVisible: args.documentVisible,
    documentFocused: args.documentFocused,
  });
}

function rememberNotificationKey(key: string): boolean {
  if (notifiedKeys.has(key)) {
    return false;
  }
  notifiedKeys.add(key);
  notifiedKeyOrder.push(key);
  while (notifiedKeyOrder.length > MAX_NOTIFIED_KEYS) {
    const staleKey = notifiedKeyOrder.shift();
    if (staleKey) {
      notifiedKeys.delete(staleKey);
    }
  }
  return true;
}

export function setVisibleNotificationTargets(targets: readonly NotificationTarget[]): void {
  visibleNotificationTargets = targets.map((target) => ({ ...target }));
}

export function readBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export function isBrowserNotificationSupported(): boolean {
  return readBrowserNotificationPermission() !== "unsupported";
}

export function isBrowserNotificationEnabled(): boolean {
  return (
    isBrowserNotificationSupported() &&
    readBrowserNotificationPermission() === "granted" &&
    readBoolean(NOTIFICATIONS_ENABLED_KEY, true)
  );
}

/**
 * Browsers require permission prompts to follow a user gesture. RAH defaults
 * notifications on and requests permission on the first interaction instead
 * of silently leaving a fresh install disabled.
 */
export function initializeBrowserNotificationPermissionRequest(): () => void {
  if (!isBrowser() || readBoolean(NOTIFICATIONS_ENABLED_KEY, true) === false) return () => undefined;
  const permission = readBrowserNotificationPermission();
  if (permission === "granted") {
    void ensureRahNotificationServiceWorker();
    return () => undefined;
  }
  if (permission !== "default") return () => undefined;
  let disposed = false;
  const request = () => {
    if (disposed) return;
    dispose();
    void Notification.requestPermission().then((permission) => {
      writeBoolean(NOTIFICATIONS_ENABLED_KEY, permission === "granted");
      if (permission === "granted") void ensureRahNotificationServiceWorker();
      dispatchNotificationSettingsEvent();
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("pointerup", request);
    window.removeEventListener("keyup", request);
  };
  window.addEventListener("pointerup", request, { once: true });
  window.addEventListener("keyup", request, { once: true });
  return dispose;
}

export function setVisibleRoomNotificationTarget(target: VisibleRoomNotificationTarget | null): void {
  visibleRoomNotificationTarget = target;
}

/**
 * A focused Room is not automatically read. Suppress a native notification
 * only when its exact canonical entity is mounted on the matching surface.
 */
export function roomInboxItemIsPresented(
  item: RoomInboxItem,
  target: VisibleRoomNotificationTarget | null,
): boolean {
  if (!target || target.roomId !== item.roomId) return false;
  if (item.aggregateType === "message") {
    return target.tab === "chat" && target.latest && target.entities.some(
      (entity) => entity.type === "message" && entity.id === item.aggregateId,
    );
  }
  if (target.tab !== "tasks") return false;
  const taskId = item.taskId ?? (item.aggregateType === "task" ? item.aggregateId : null);
  return Boolean(taskId && target.entities.some(
    (entity) => entity.type === "task" && entity.id === taskId,
  ));
}

export function roomInboxItemNeedsNotification(item: RoomInboxItem): boolean {
  return item.state === "pending";
}

export function notificationCandidateFromRoomInbox(
  item: RoomInboxItem,
  roomName?: string,
): RahNotificationCandidate {
  const label = roomName?.trim() || "Room";
  const taskBodyByEvent: Partial<Record<NonNullable<RoomInboxItem["eventType"]>, string>> = {
    "task.created": "A task was assigned to you.",
    "task.submitted": "A task is ready for review.",
    "review.submitted": item.reviewDisposition === "approved"
      ? (item.reason === "input_resolved"
          ? "A reviewed task is ready for Human acceptance."
          : "A reviewer approved the task.")
      : "A reviewer returned the task.",
    "task.completed": "A task was completed.",
    "task.cancelled": "A task was closed.",
    "task.dependency_resolved": "A task dependency was resolved.",
  };
  const bodyByReason: Record<RoomInboxItem["reason"], string> = {
    direct_message: "New direct message.",
    mention: "You were mentioned in a message.",
    room_policy: "New Room activity needs your attention.",
    task_assignment: "A task needs your attention.",
    dependency_resolved: "A task dependency was resolved.",
    input_resolved: "Requested input was resolved.",
  };
  const query = new URLSearchParams({ surface: "room", roomId: item.roomId });
  if (item.taskId) {
    query.set("tab", "tasks");
    query.set("taskId", item.taskId);
  } else if (item.aggregateType === "message") {
    query.set("messageId", item.aggregateId);
  }
  return {
    key: `room:${item.roomId}:inbox:${item.inboxItemId}`,
    target: { kind: "room", id: item.roomId },
    title: `Room: ${truncate(label, 48)}`,
    body: (item.eventType ? taskBodyByEvent[item.eventType] : undefined) ?? bodyByReason[item.reason],
    url: `/?${query.toString()}`,
  };
}

export async function notifyForRoomInboxItems(args: {
  items: readonly RoomInboxItem[];
  roomNames?: ReadonlyMap<string, string>;
}): Promise<boolean> {
  if (!isBrowser()) return true;
  if (readBoolean(NOTIFICATIONS_ENABLED_KEY, true) === false) return true;
  if (!isBrowserNotificationEnabled()) return false;
  const hasFocus = document.visibilityState === "visible" && document.hasFocus();
  for (const item of args.items) {
    if (!roomInboxItemNeedsNotification(item)) continue;
    if (hasFocus && roomInboxItemIsPresented(item, visibleRoomNotificationTarget)) continue;
    const candidate = notificationCandidateFromRoomInbox(item, args.roomNames?.get(item.roomId));
    if (notifiedKeys.has(candidate.key)) continue;
    try {
      await showRahNotification(candidate);
      rememberNotificationKey(candidate.key);
    } catch (error) {
      console.warn("[rah] Room notification failed", error);
      return false;
    }
  }
  return true;
}

export async function ensureRahNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (
    !isBrowser() ||
    !("serviceWorker" in navigator) ||
    !window.isSecureContext
  ) {
    return null;
  }
  if (!notificationWorkerPromise) {
    notificationWorkerPromise = navigator.serviceWorker
      .register(NOTIFICATION_SERVICE_WORKER_URL)
      .catch(() => null);
  }
  return notificationWorkerPromise;
}

async function showRahNotification(candidate: RahNotificationCandidate): Promise<void> {
  if (!isBrowserNotificationEnabled()) {
    return;
  }
  const options: NotificationOptions = {
    body: candidate.body,
    tag: candidate.key,
    data: { url: candidate.url, target: candidate.target },
  };
  const registration = await ensureRahNotificationServiceWorker();
  if (registration?.showNotification) {
    await registration.showNotification(candidate.title, options);
    return;
  }
  new Notification(candidate.title, options);
}

export function notifyForRahEvents(args: {
  events: readonly RahEvent[];
  projections: ReadonlyMap<string, { summary: SessionSummary }>;
  activeTargets?: readonly NotificationTarget[];
}): void {
  if (!isBrowser() || !isBrowserNotificationEnabled()) {
    return;
  }
  const environment: NotificationEnvironment = {
    activeTargets: args.activeTargets ?? visibleNotificationTargets,
    documentVisible: document.visibilityState === "visible",
    documentFocused: document.hasFocus(),
  };
  for (const event of args.events) {
    const summary = args.projections.get(event.sessionId)?.summary ?? null;
    const candidate = notificationCandidateFromEvent(event, summary);
    if (!candidate || isActivelyViewingTarget(candidate.target, environment)) {
      continue;
    }
    if (!rememberNotificationKey(candidate.key)) {
      continue;
    }
    void showRahNotification(candidate).catch((error) => {
      console.warn("[rah] browser notification failed", error);
    });
  }
}

export function useBrowserNotificationSettings(): {
  supported: boolean;
  permission: BrowserNotificationPermission;
  enabled: boolean;
  pending: boolean;
  enable: () => Promise<void>;
  disable: () => void;
  toggle: () => Promise<void>;
} {
  const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
    readBrowserNotificationPermission(),
  );
  const [enabledPreference, setEnabledPreference] = useState<boolean>(() =>
    readBoolean(NOTIFICATIONS_ENABLED_KEY, true),
  );
  const [pending, setPending] = useState(false);

  const syncState = useCallback(() => {
    setPermission(readBrowserNotificationPermission());
    setEnabledPreference(readBoolean(NOTIFICATIONS_ENABLED_KEY, true));
  }, []);

  useEffect(() => {
    if (!isBrowser()) {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATIONS_ENABLED_KEY) {
        syncState();
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(NOTIFICATIONS_SETTINGS_EVENT, syncState);
    window.addEventListener("focus", syncState);
    document.addEventListener("visibilitychange", syncState);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(NOTIFICATIONS_SETTINGS_EVENT, syncState);
      window.removeEventListener("focus", syncState);
      document.removeEventListener("visibilitychange", syncState);
    };
  }, [syncState]);

  const disable = useCallback(() => {
    writeBoolean(NOTIFICATIONS_ENABLED_KEY, false);
    setEnabledPreference(false);
    setPermission(readBrowserNotificationPermission());
    dispatchNotificationSettingsEvent();
  }, []);

  const enable = useCallback(async () => {
    if (readBrowserNotificationPermission() === "unsupported") {
      return;
    }
    setPending(true);
    try {
      let nextPermission = readBrowserNotificationPermission();
      if (nextPermission === "default") {
        nextPermission = await Notification.requestPermission();
      }
      if (nextPermission === "granted") {
        writeBoolean(NOTIFICATIONS_ENABLED_KEY, true);
        setEnabledPreference(true);
        void ensureRahNotificationServiceWorker();
      } else {
        writeBoolean(NOTIFICATIONS_ENABLED_KEY, false);
        setEnabledPreference(false);
      }
      setPermission(nextPermission);
      dispatchNotificationSettingsEvent();
    } finally {
      setPending(false);
    }
  }, []);

  const enabled = permission === "granted" && enabledPreference;
  const toggle = useCallback(async () => {
    if (enabled) {
      disable();
      return;
    }
    await enable();
  }, [disable, enable, enabled]);

  return {
    supported: permission !== "unsupported",
    permission,
    enabled,
    pending,
    enable,
    disable,
    toggle,
  };
}
