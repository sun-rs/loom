import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { MessageSocialStore } from "../message-social-store.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import reactionSprite from "../raft-reaction-sprite.svg?url";

const Context = createContext<MessageSocialStore | null>(null);
const emptySubscribe = () => () => {};
// Exact Raft t8 quick-reaction list; the full emoji composer is a different feature.
export const QUICK_REACTIONS = [
  "👍",
  "❤️",
  "🎉",
  "👀",
  "🔥",
  "😂",
  "✅",
] as const;
// Raft's active bookmark is the same Lucide geometry with a currentColor fill.
// Keep it inline so the external SVG symbol's fill="none" cannot win visually.
function BookmarkGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" />
    </svg>
  );
}
function ReactionGlyph({ emoji, size = 18 }: { emoji: string; size?: number }) {
  const index = QUICK_REACTIONS.indexOf(
    emoji as (typeof QUICK_REACTIONS)[number],
  );
  return index < 0 ? (
    <span style={{ fontSize: `${size}px`, lineHeight: 1 }}>{emoji}</span>
  ) : (
    <span
      aria-hidden="true"
      className="rah-reaction-glyph"
      style={{
        backgroundImage: `url(${reactionSprite})`,
        backgroundPosition: `${-size * index}px 0`,
        backgroundSize: `${QUICK_REACTIONS.length * size}px ${size}px`,
        width: `${size}px`,
        height: `${size}px`,
      }}
    />
  );
}
export function MessageSocialProvider({
  client,
  enabled,
  children,
}: {
  client: RahClient;
  enabled: boolean;
  children: ReactNode;
}) {
  const [store] = useState(() => new MessageSocialStore(client));
  const lifetime = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    const timer = setInterval(refresh, 2500);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, store]);
  useEffect(() => {
    const epoch = ++lifetime.current;
    return () =>
      queueMicrotask(() => {
        // React StrictMode replays effects; only an actual unmount owns disposal.
        if (lifetime.current === epoch) store.dispose();
      });
  }, [store]);
  return (
    <Context.Provider value={enabled ? store : null}>
      {children}
    </Context.Provider>
  );
}
export function useMessageSocial(message: {
  roomId?: string;
  messageId: string;
  roomSeq: number;
}) {
  const store = useContext(Context);
  useEffect(() => {
    if (!store || !message.roomId) return;
    const release = store.watch(message.roomId, message.messageId);
    const timer = setTimeout(() => void store.refresh(), 0);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [store, message.roomId, message.messageId]);
  const state = useSyncExternalStore(
    store?.subscribe ?? emptySubscribe,
    () =>
      message.roomId
        ? store?.read(message.roomId, message.messageId)
        : undefined,
    () => undefined,
  );
  return {
    state,
    enabled: !!store && !!message.roomId,
    mutate: (kind: "save" | "reaction", active: boolean, emoji?: string) =>
      message.roomId
        ? store
            ?.mutate(
              { ...message, roomId: message.roomId },
              kind,
              active,
              emoji,
            )
            .catch(() => {})
        : undefined,
  };
}
export type MessageSocialView = ReturnType<typeof useMessageSocial>;
export function MessageSocialButtons({ view }: { view: MessageSocialView }) {
  if (!view.enabled) return null;
  const { data, pending } = view.state ?? {};
  return (
    <>
      <DiscoveryFilter
        label="添加回应"
        icon="smile-plus"
        triggerLabel=""
        triggerAriaLabel="添加回应"
        className="rah-reaction-picker"
        variant="reaction"
        selected={false}
        searchable={false}
        clearable={false}
        multiple={false}
        showCount={false}
        disabled={pending || !data}
        values={[]}
        options={QUICK_REACTIONS.map((emoji) => ({
          id: emoji,
          label: `用 ${emoji} 回应`,
          leading: <ReactionGlyph emoji={emoji} />,
        }))}
        onChange={([emoji]) => {
          if (emoji)
            void view.mutate(
              "reaction",
              !data?.reactions.some((r) => r.emoji === emoji && r.mine),
              emoji,
            );
        }}
      />
      <button
        type="button"
        className={`msg-action-btn${data?.saved ? " is-saved" : ""}`}
        data-message-affordance="bookmark"
        aria-label={data?.saved ? "从收藏中移除" : "收藏消息"}
        title={data?.saved ? "从收藏中移除" : "收藏消息"}
        aria-pressed={data?.saved ?? false}
        disabled={pending || !data}
        onClick={() => void view.mutate("save", !data?.saved)}
      >
        <BookmarkGlyph filled={Boolean(data?.saved)} />
      </button>
    </>
  );
}
export function MessageReactionSummary({ view }: { view: MessageSocialView }) {
  const saved = view.state?.data?.saved ?? false;
  const reactions = view.state?.data?.reactions ?? [];
  const error = view.state?.error;
  if (!saved && reactions.length === 0 && error === undefined) return null;
  return (
    <>
      {(saved || reactions.length > 0) && (
        <div className="rah-message-social-summary">
          {saved && (
            <button
              type="button"
              className="rah-message-saved-badge"
              data-message-affordance="saved-badge"
              aria-label="从收藏中移除"
              title="从收藏中移除"
              disabled={view.state?.pending}
              onClick={() => void view.mutate("save", false)}
            >
              <BookmarkGlyph filled />
              <span>已保存</span>
            </button>
          )}
          {reactions.map((r) => (
            <span className="rah-message-reaction-slot" key={r.emoji}>
              <button
                type="button"
                className="rah-message-reaction"
                data-message-affordance="reaction-chip"
                aria-label={`${r.emoji} ${r.count} 个回应`}
                aria-pressed={r.mine}
                disabled={view.state?.pending}
                title={
                  r.actors.map((p) => p.name).join(", ") +
                  (r.count > r.actors.length
                    ? `，另外 ${r.count - r.actors.length} 位成员`
                    : "")
                }
                onClick={() => void view.mutate("reaction", !r.mine, r.emoji)}
              >
                <span className="rah-message-reaction-icon">
                  <ReactionGlyph emoji={r.emoji} size={15} />
                </span>
                <span className="rah-message-reaction-count">{r.count}</span>
              </button>
            </span>
          ))}
        </div>
      )}
      {error && (
        <div className="rah-message-action-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
