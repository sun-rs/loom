import { useCallback, useEffect, useRef, useState } from "react";

import type { RahClient, RahClientOperationMap } from "@rah-os/client-sdk";

import type { DiscoveryNavigationHandler } from "../global-discovery-model.ts";
import { socialRequestId } from "../message-social-store.ts";
import { mergeSavedMessages } from "../saved-messages-model.ts";
import { Icon } from "./icon.tsx";
import { SavedMessageCard } from "./saved-message-card.tsx";

type Saved = RahClientOperationMap["message.saved"]["output"];

/** Raft SavedPanel: private references, newest saved first, exact message navigation. */
export function SavedMessagesPane({
  client,
  workspaceId,
  onOpen,
  onOpenRooms,
}: {
  client: RahClient;
  workspaceId: string;
  onOpen: DiscoveryNavigationHandler;
  onOpenRooms: () => void;
}) {
  const [result, setResult] = useState<Saved>({
      items: [],
      total: 0,
      globalTotal: 0,
    }),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>(),
    [removing, setRemoving] = useState<string>();
  const head = useRef(result),
    generation = useRef(0),
    loading = useRef(false),
    scroll = useRef<HTMLDivElement>(null),
    sentinel = useRef<HTMLDivElement>(null);
  const load = useCallback(
    async (reset = false) => {
      if (loading.current) return;
      loading.current = true;
      setPending(true);
      setError(undefined);
      const epoch = generation.current;
      try {
        const cursor = reset ? undefined : head.current.nextCursor;
        const page = await client.request("message.saved", {
          workspaceId,
          query: "",
          sortDirection: "desc",
          limit: 20,
          ...(cursor ? { cursor } : {}),
        });
        if (epoch !== generation.current) return;
        head.current = {
          ...page,
          items: reset
            ? page.items
            : mergeSavedMessages(head.current.items, page.items),
        };
        setResult(head.current);
      } catch (caught) {
        if (epoch === generation.current)
          setError(
            caught instanceof Error ? caught.message : "读取已保存消息失败",
          );
      } finally {
        if (epoch === generation.current) {
          loading.current = false;
          setPending(false);
        }
      }
    },
    [client, workspaceId],
  );
  useEffect(() => {
    void load(true);
    return () => {
      ++generation.current;
      loading.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (!result.nextCursor || pending || error || !sentinel.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load();
      },
      { root: scroll.current, rootMargin: "240px 0px", threshold: 0 },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [result.nextCursor, pending, error, load]);
  async function remove(row: Saved["items"][number]) {
    if (removing) return;
    setRemoving(row.message.messageId);
    setError(undefined);
    const epoch = generation.current;
    try {
      await client.request("message.save", {
        roomId: row.message.roomId,
        messageId: row.message.messageId,
        saved: false,
        idempotencyKey: socialRequestId(),
      });
      if (epoch !== generation.current) return;
      head.current = {
        ...head.current,
        total: Math.max(0, head.current.total - 1),
        globalTotal: Math.max(0, head.current.globalTotal - 1),
        items: head.current.items.filter(
          ({ message }) => message.messageId !== row.message.messageId,
        ),
      };
      setResult(head.current);
    } catch (caught) {
      if (epoch === generation.current)
        setError(caught instanceof Error ? caught.message : "取消收藏失败");
    } finally {
      if (epoch === generation.current) setRemoving(undefined);
    }
  }
  const initialLoading = pending && result.items.length === 0;
  return (
    <main className="channel rah-saved-pane">
      <header className="rah-saved-header">
        <button
          aria-label="打开 Room 列表"
          className="sq-btn rah-mobile-only"
          onClick={onOpenRooms}
          type="button"
        >
          <Icon name="menu" />
        </button>
        <span className="rah-saved-header-icon">
          <Icon name="bookmark" />
        </span>
        <span className="rah-saved-header-copy">
          <strong>已保存</strong>
          <span>{result.globalTotal} 项</span>
        </span>
      </header>
      <div
        className="rah-saved-scroll"
        data-testid="saved-list-scroller"
        ref={scroll}
      >
        {error ? (
          <p className="rah-saved-error" role="alert">
            {error}
          </p>
        ) : null}
        {initialLoading ? <SavedSkeleton /> : null}
        {!initialLoading && !result.items.length && !error ? (
          <div className="rah-saved-empty">
            <Icon name="bookmark" />
            <strong>暂无收藏的消息</strong>
            <p>选择消息上的书签图标即可保存。</p>
          </div>
        ) : null}
        {result.items.length ? (
          <div className="rah-saved-list">
            {result.items.map((row) => (
              <SavedMessageCard
                key={row.message.messageId}
                onError={setError}
                onOpen={() => void onOpen({ target: row.target })}
                onRemove={() => remove(row)}
                removing={removing === row.message.messageId}
                row={row}
              />
            ))}
            {result.nextCursor ? (
              <div
                aria-live="polite"
                className="rah-saved-sentinel"
                data-testid="saved-infinite-scroll-sentinel"
                ref={sentinel}
              >
                {pending ? (
                  <span>正在加载更多已保存消息</span>
                ) : (
                  <span className="rah-sr-only">正在加载更多已保存消息</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function SavedSkeleton() {
  return (
    <div aria-busy="true" className="rah-saved-skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="rah-saved-skeleton-card" key={index}>
          <div>
            <span className="is-20" />
            <span className="is-16" />
            <span className="is-10" />
          </div>
          <span className="is-full" />
          <span className="is-three-fifths" />
        </div>
      ))}
    </div>
  );
}
