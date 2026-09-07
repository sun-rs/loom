import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
export function ReactionGlyph({
  emoji,
  size = 18,
}: {
  emoji: string;
  size?: number;
}) {
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

type ReactionActorsPopoverState = Readonly<{
  emoji: string;
  visibleNames: readonly string[];
  hiddenCount: number;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
}>;

function reactionActorNames(reaction: {
  mine: boolean;
  actors: readonly { name: string }[];
}): string[] {
  return reaction.actors.map((actor, index) =>
    reaction.mine && index === 0 ? "你" : actor.name,
  );
}

export function MessageSocialButtons({ view }: { view: MessageSocialView }) {
  if (!view.enabled) return null;
  const { data, pending } = view.state ?? {};
  return (
    <>
      {data?.canReact !== false && (
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
      )}
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
  const [actorsPopover, setActorsPopover] =
    useState<ReactionActorsPopoverState>();
  const actorsPopoverRef = useRef<HTMLDivElement>(null);

  const closeActorsPopover = () => setActorsPopover(undefined);
  const openActorsPopover = (
    reaction: (typeof reactions)[number],
    target: HTMLButtonElement,
  ) => {
    const bounds = target.getBoundingClientRect();
    const visibleNames = reactionActorNames(reaction).slice(0, 5);
    setActorsPopover({
      emoji: reaction.emoji,
      visibleNames,
      hiddenCount: Math.max(0, reaction.count - visibleNames.length),
      anchorX: bounds.left,
      anchorY: bounds.bottom + 4,
      x: bounds.left,
      y: bounds.bottom + 4,
    });
  };

  useLayoutEffect(() => {
    const tooltip = actorsPopoverRef.current;
    if (!actorsPopover || !tooltip) return;
    const bounds = tooltip.getBoundingClientRect();
    const margin = 8;
    const x = Math.max(
      margin,
      Math.min(
        actorsPopover.anchorX,
        window.innerWidth - bounds.width - margin,
      ),
    );
    const y = Math.max(
      margin,
      Math.min(
        actorsPopover.anchorY,
        window.innerHeight - bounds.height - margin,
      ),
    );
    if (x !== actorsPopover.x || y !== actorsPopover.y) {
      setActorsPopover({ ...actorsPopover, x, y });
    }
  }, [actorsPopover]);

  useEffect(() => {
    if (!actorsPopover) return;
    const close = () => setActorsPopover(undefined);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [actorsPopover]);

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
              {(() => {
                const actorNames = reactionActorNames(r);
                const hiddenCount = Math.max(0, r.count - actorNames.length);
                const actorSummary =
                  actorNames.join(", ") +
                  (hiddenCount > 0
                    ? `${actorNames.length > 0 ? "，" : ""}另外 ${hiddenCount} 位成员`
                    : "");
                return (
                  <button
                    type="button"
                    className="rah-message-reaction"
                    data-message-affordance="reaction-chip"
                    aria-label={`${r.emoji} ${r.count} 个回应${actorSummary ? `：${actorSummary}` : ""}`}
                    aria-describedby={
                      actorsPopover?.emoji === r.emoji
                        ? `rah-reaction-actors-${encodeURIComponent(r.emoji)}`
                        : undefined
                    }
                    aria-pressed={r.mine}
                    disabled={view.state?.pending}
                    onMouseEnter={(event) =>
                      openActorsPopover(r, event.currentTarget)
                    }
                    onMouseLeave={closeActorsPopover}
                    onFocus={(event) =>
                      openActorsPopover(r, event.currentTarget)
                    }
                    onBlur={closeActorsPopover}
                    onClick={() => {
                      closeActorsPopover();
                      if (view.state?.data?.canReact !== false)
                        void view.mutate("reaction", !r.mine, r.emoji);
                    }}
                  >
                    <span className="rah-message-reaction-icon">
                      <ReactionGlyph emoji={r.emoji} size={15} />
                    </span>
                    <span className="rah-message-reaction-count">
                      {r.count}
                    </span>
                  </button>
                );
              })()}
            </span>
          ))}
        </div>
      )}
      {actorsPopover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={actorsPopoverRef}
            id={`rah-reaction-actors-${encodeURIComponent(actorsPopover.emoji)}`}
            role="tooltip"
            data-message-affordance="reaction-reactors-popover"
            className="rah-reaction-reactors-popover"
            style={{ left: actorsPopover.x, top: actorsPopover.y }}
          >
            {actorsPopover.visibleNames.length > 0 ? (
              <div className="rah-reaction-reactors-names">
                {actorsPopover.visibleNames.map((name, index) => (
                  <span
                    className="rah-reaction-reactor-name"
                    key={`${actorsPopover.emoji}-${index}-${name}`}
                  >
                    <span>{name}</span>
                    {index < actorsPopover.visibleNames.length - 1 ||
                    actorsPopover.hiddenCount > 0 ? (
                      <span className="rah-reaction-reactor-separator">, </span>
                    ) : null}
                  </span>
                ))}
                {actorsPopover.hiddenCount > 0 && (
                  <span className="rah-reaction-reactors-hidden">
                    另外 {actorsPopover.hiddenCount} 位成员
                  </span>
                )}
              </div>
            ) : (
              <span>{actorsPopover.emoji}</span>
            )}
          </div>,
          document.body,
        )}
      {error && (
        <div className="rah-message-action-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
