import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useEffect, useMemo, useState } from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type { ClientMessageForwardResult, Room } from "@rah-os/protocol";

import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export function MessageForwardDialog({
  client,
  onClose,
  onComplete,
  sourceMessageIds,
  sourceRoomId,
}: {
  client: RahClient;
  onClose: () => void;
  onComplete: () => void;
  sourceMessageIds: readonly string[];
  sourceRoomId: string;
}) {
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<readonly Room[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [results, setResults] = useState<readonly ClientMessageForwardResult[]>(
    [],
  );
  const [attempted, setAttempted] = useState(false);
  const [requestId] = useState(() => `forward-${browserOpaqueId()}`);
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const deliveredIds = useMemo(
    () =>
      new Set(
        results.flatMap((result) =>
          result.status === "delivered" ? [result.destinationRoomId] : [],
        ),
      ),
    [results],
  );
  const remainingIds = selectedIds.filter(
    (destinationRoomId) => !deliveredIds.has(destinationRoomId),
  );

  useEffect(() => {
    if (attempted) return;
    let current = true;
    const timeout = window.setTimeout(
      () => {
        setLoading(true);
        void client
          .request("message.forward.targets", {
            limit: 20,
            query,
            sourceRoomId,
          })
          .then(({ rooms }) => {
            if (!current) return;
            setTargets(rooms);
            setLoadError(undefined);
          })
          .catch((error) => {
            if (current) setLoadError(errorMessage(error));
          })
          .finally(() => {
            if (current) setLoading(false);
          });
      },
      query.length === 0 ? 0 : 180,
    );
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [attempted, client, query, sourceRoomId]);

  async function submit() {
    if (pending || remainingIds.length === 0) return;
    setPending(true);
    try {
      const response = await client.request("message.forward", {
        destinationRoomIds: remainingIds,
        ...(note.trim().length === 0 ? {} : { note: note.trim() }),
        requestId,
        sourceMessageIds: [...sourceMessageIds],
        sourceRoomId,
      });
      const next = [
        ...results.filter(({ destinationRoomId }) =>
          deliveredIds.has(destinationRoomId),
        ),
        ...response.results,
      ];
      setResults(next);
      setAttempted(true);
      if (next.every((result) => result.status === "delivered")) onComplete();
    } catch (error) {
      setLoadError(errorMessage(error));
      setAttempted(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭转发消息窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="rah-message-forward-title"
        aria-modal="true"
        className="rah-dialog rah-message-forward-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-message-forward-title">
              转发 {sourceMessageIds.length} 条消息
            </h2>
            <p>最多选择 10 个已加入的同工作区对话</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <Icon name="x" />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            搜索对话
            <input
              data-dialog-initial-focus
              disabled={attempted}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="频道或私信名称"
              type="search"
              value={query}
            />
          </label>
          <fieldset className="rah-message-forward-targets">
            <legend>发送到</legend>
            {loading ? <p>正在载入…</p> : null}
            {!loading && targets.length === 0 ? <p>没有可用对话</p> : null}
            {targets.map((room) => {
              const checked = selectedIds.includes(room.roomId);
              const result = results.find(
                ({ destinationRoomId }) => destinationRoomId === room.roomId,
              );
              return (
                <label key={room.roomId}>
                  <input
                    checked={checked}
                    disabled={
                      attempted || (!checked && selectedIds.length >= 10)
                    }
                    onChange={() =>
                      setSelectedIds((current) =>
                        current.includes(room.roomId)
                          ? current.filter((item) => item !== room.roomId)
                          : [...current, room.roomId],
                      )
                    }
                    type="checkbox"
                  />
                  <span aria-hidden="true">
                    {room.kind === "direct" ? "@" : "#"}
                  </span>
                  <span>{room.name}</span>
                  {result === undefined ? null : (
                    <small data-status={result.status}>
                      {result.status === "delivered"
                        ? "已发送"
                        : result.message}
                    </small>
                  )}
                </label>
              );
            })}
          </fieldset>
          <label>
            附言（可选）
            <textarea
              disabled={attempted}
              maxLength={4_000}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              value={note}
            />
          </label>
          {loadError === undefined ? null : (
            <p className="rah-dialog-error" role="alert">
              {loadError}
            </p>
          )}
          <footer>
            <button disabled={pending} onClick={onClose} type="button">
              取消
            </button>
            <button
              className="primary"
              disabled={pending || remainingIds.length === 0}
              type="submit"
            >
              {pending
                ? "正在发送…"
                : attempted
                  ? `重试失败项 (${remainingIds.length})`
                  : `转发 (${selectedIds.length})`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "转发消息失败";
}
