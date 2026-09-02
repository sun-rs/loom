import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RahClient, RahClientOperationMap } from "@rah-os/client-sdk";
import type { DiscoveryNavigationHandler } from "../global-discovery-model.ts";
import { socialRequestId } from "../message-social-store.ts";
import { Icon } from "./icon.tsx";
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
  const [result, setResult] = useState<Saved>({ items: [], total: 0 }),
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
          limit: 50,
          ...(cursor ? { cursor } : {}),
        });
        if (epoch === generation.current) {
          const items = reset
            ? page.items
            : [
                ...head.current.items,
                ...page.items.filter(
                  (row) =>
                    !head.current.items.some(
                      (old) => old.message.messageId === row.message.messageId,
                    ),
                ),
              ];
          head.current = { ...page, items };
          setResult(head.current);
        }
      } catch (e) {
        if (epoch === generation.current)
          setError(e instanceof Error ? e.message : "读取已保存消息失败");
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
        if (entries.some((e) => e.isIntersecting)) void load();
      },
      { root: scroll.current, rootMargin: "240px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [result.nextCursor, pending, error, load]);
  const virtual = useVirtualizer({
    count: result.items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 150,
    overscan: 5,
    getItemKey: (index) => result.items[index]!.message.messageId,
  });
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
      if (epoch === generation.current) {
        head.current = {
          ...head.current,
          total: Math.max(0, head.current.total - 1),
          items: head.current.items.filter(
            (r) => r.message.messageId !== row.message.messageId,
          ),
        };
        setResult(head.current);
      }
    } catch (e) {
      if (epoch === generation.current)
        setError(e instanceof Error ? e.message : "取消收藏失败");
    } finally {
      if (epoch === generation.current) setRemoving(undefined);
    }
  }
  return (
    <main className="channel rah-saved-pane">
      <header className="channel-head">
        <button
          type="button"
          className="sq-btn rah-mobile-only"
          aria-label="打开 Room 列表"
          onClick={onOpenRooms}
        >
          <Icon name="menu" />
        </button>
        <Icon name="bookmark" />
        <strong>已保存</strong>
        <span>{result.total}</span>
        <button
          type="button"
          className="sq-btn rah-saved-refresh"
          aria-label="刷新已保存"
          disabled={pending || !!removing}
          onClick={() => void load(true)}
        >
          <Icon name="refresh-cw" />
        </button>
      </header>
      <div ref={scroll} className="rah-saved-scroll">
        {error && <p role="alert">{error}</p>}
        {!pending && !result.items.length && !error && (
          <div className="rah-saved-empty">
            <Icon name="bookmark" />
            <strong>暂无已保存的消息</strong>
            <p>将重要消息保存到这里。</p>
          </div>
        )}
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = result.items[item.index]!;
            return (
              <div
                key={item.key}
                ref={virtual.measureElement}
                data-index={item.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <article className="rah-saved-card">
                  <button
                    type="button"
                    className="rah-saved-open"
                    aria-label={`打开已保存消息 ${row.senderName}`}
                    onClick={() => void onOpen({ target: row.target })}
                  >
                    <small>
                      {row.rootMessageId ? "话题 · " : ""}
                      {row.roomName}
                    </small>
                    <div>
                      <strong>{row.senderName}</strong>{" "}
                      <time>
                        {new Date(row.message.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p>{row.message.body}</p>
                  </button>
                  <button
                    type="button"
                    className="rah-saved-remove"
                    aria-label={`取消收藏 ${row.senderName} 的消息`}
                    disabled={!!removing}
                    onClick={() => void remove(row)}
                  >
                    <Icon name="bookmark" />
                  </button>
                </article>
              </div>
            );
          })}
        </div>
        <div ref={sentinel}>
          {pending ? (
            <p role="status">加载中…</p>
          ) : result.nextCursor ? (
            <button type="button" className="btn" onClick={() => void load()}>
              加载更多
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
