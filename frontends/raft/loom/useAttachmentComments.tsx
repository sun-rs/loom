import { pageFetch } from "./page-fetch.ts";
import {
  createContext,
  useContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "raft-ui";
import { HttpRahClient } from "@rah-os/client-sdk";
import type { AttachmentCommentsResponse } from "@rah-os/protocol";
import type { CommentAnchor } from "../packages/web/src/components/message/attachmentCommentAnchors.ts";
import { AttachmentCommentsClient } from "./attachment-comments-client.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
const client = new HttpRahClient({
  fetch: pageFetch,
  baseUrl: "",
  accessToken: () => "trusted-proxy-auth",
});
type Scope = {
  wholeFileOnly?: boolean;
  attachmentId: string;
  parentMessage: { id: string; channelId: string };
};
function useCommentsOwner({
  attachmentId,
  parentMessage,
  wholeFileOnly = false,
}: Scope) {
  const bridge = useMemo(
    () =>
      new AttachmentCommentsClient(
        client,
        parentMessage.channelId,
        parentMessage.id,
        attachmentId,
      ),
    [attachmentId, parentMessage.channelId, parentMessage.id],
  );
  useRouteIntentOwner(bridge.writes);
  const [data, setData] = useState<AttachmentCommentsResponse>();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState(bridge.writes.state);
  const [page, setPage] = useState<(number | undefined)[]>([undefined]);
  const [tick, setTick] = useState(0);
  const cursor = page.at(-1);
  useEffect(() => bridge.writes.onChange(setState), [bridge]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await bridge.read(controller.signal, cursor);
        if (!controller.signal.aborted) {
          setData(result);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted) setError("无法读取批注，请重新读取。");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 3000);
      }
    };
    setData(undefined);
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [bridge, cursor, tick]);
  const sendComment = async (
    body: string,
    anchor: CommentAnchor | null,
    mentions: { id: string }[],
  ) => {
    if (!data?.viewer.canComment || state !== "idle" || error)
      throw Error("当前不可发送批注");
    await bridge.send(
      body,
      wholeFileOnly ? null : anchor,
      mentions.map((m) => m.id),
    );
    setPage([undefined]);
    setTick((n) => n + 1);
  };
  const comments =
    data?.comments.map((c) => ({
      ...c,
      channelId: c.roomId,
      senderType:
        c.senderType === "human" ? ("user" as const) : ("agent" as const),
      senderAvatarUrl: null,
      senderGravatarHash: null,
    })) ?? null;
  const controls = (
    <>
      {wholeFileOnly && (
        <p className="px-3 py-2 text-footnote text-foreground-secondary">
          评论针对整份 PDF，不定位页码或选区。
        </p>
      )}
      {state === "unknown" && (
        <div role="alert" className="p-2 text-xs">
          批注结果未知，请核实原请求。
          <Button size="sm" onClick={() => void bridge.writes.retry()}>
            核实批注结果
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="p-2 text-xs">
          {error}
          <Button size="sm" onClick={() => setTick((n) => n + 1)}>
            重新读取
          </Button>
        </div>
      )}
      {(page.length > 1 || data?.nextBeforeRoomSeq) && (
        <div className="flex gap-2 p-2">
          {page.length > 1 && (
            <Button
              size="sm"
              disabled={state !== "idle"}
              onClick={() => setPage((p) => p.slice(0, -1))}
            >
              较新批注
            </Button>
          )}
          {data?.nextBeforeRoomSeq && (
            <Button
              size="sm"
              disabled={state !== "idle"}
              onClick={() => setPage((p) => [...p, data.nextBeforeRoomSeq])}
            >
              较早批注
            </Button>
          )}
        </div>
      )}
    </>
  );
  return {
    comments,
    wholeFileOnly,
    pendingComments: [],
    error,
    sendComment,
    controls,
    canComment: data?.viewer.canComment ?? false,
    submitDisabled: state !== "idle" || !data || !!error,
    writeBlockedCopy: data ? "当前附件不可批注" : "正在读取附件权限…",
  };
}

const Context = createContext<ReturnType<typeof useCommentsOwner> | null>(null);
/** One owner for the native desktop drawer and mobile sheet, which coexist in the DOM. */
export function AttachmentCommentsOwner({
  children,
  ...scope
}: Scope & { children: ReactNode }) {
  const owner = useCommentsOwner(scope);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}
export function useAttachmentComments({
  pendingAnchor,
  getPendingAnchor,
  onAnchorCleared,
}: Scope & {
  pendingAnchor?: CommentAnchor | null;
  getPendingAnchor?: () => CommentAnchor | null;
  onAnchorCleared?: () => void;
}) {
  const owner = useContext(Context);
  const listRef = useRef<HTMLDivElement | null>(null);
  if (!owner) throw Error("Attachment comment owner is unavailable");
  return {
    ...owner,
    listRef,
    activeAnchor: owner.wholeFileOnly ? null : (pendingAnchor ?? null),
    clearActiveAnchor: () => onAnchorCleared?.(),
    sendComment: async (body: string, mentions: { id: string }[]) => {
      await owner.sendComment(
        body,
        getPendingAnchor ? getPendingAnchor() : (pendingAnchor ?? null),
        mentions,
      );
      onAnchorCleared?.();
    },
  };
}
