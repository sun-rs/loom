import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Message } from "../packages/web/src/store/messageStore.ts";
import { showToast } from "../packages/web/src/components/toastBridge.ts";
import {
  ReactionClient,
  reactionRoomWritable,
  type ReactionBridge,
  type SocialItem,
} from "./reaction-client.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
const Context = createContext<{
  roomId: string;
  items: Map<string, SocialItem>;
  disabled: boolean;
  toggle: (id: string, emoji: string) => void;
} | null>(null);
export function MessageReactionsProvider({
  bridge,
  messages,
  children,
}: {
  bridge: ReactionBridge;
  messages: Message[];
  children: ReactNode;
}) {
  const owner = useMemo(() => new ReactionClient(bridge), [bridge]);
  const ids = JSON.stringify(
    messages.filter((m) => m.messageType !== "system").map((m) => m.id),
  );
  const [items, setItems] = useState(new Map<string, SocialItem>()),
    [state, setState] = useState(bridge.writes.state);
  const current = useRef(owner);
  current.current = owner;
  const latest = useRef(items);
  latest.current = items;
  useRouteIntentOwner(bridge.writes);
  useEffect(() => bridge.writes.onChange(setState), [bridge]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setItems(new Map());
    const read = async () => {
      try {
        const rows = await owner.read(JSON.parse(ids), abort.signal);
        if (!abort.signal.aborted)
          setItems(
            (old) =>
              new Map(
                rows.map((row) => [
                  row.messageId,
                  (old.get(row.messageId)?.version ?? -1) > row.version
                    ? old.get(row.messageId)!
                    : row,
                ]),
              ),
          );
      } catch {
        if (!abort.signal.aborted) setItems(new Map());
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 15000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [owner, ids]);
  const writable = reactionRoomWritable(bridge.room.state.snapshot?.room);
  const toggle = (id: string, emoji: string) => {
    const row = latest.current.get(id);
    if (!writable || !row?.canReact || bridge.writes.state !== "idle") return;
    void owner
      .set(
        id,
        emoji,
        !row.reactions.some((r) => r.emoji === emoji && r.mine),
        (outcome) => {
          if (current.current !== owner) return;
          if (outcome.kind === "ok") {
            const row = outcome.result;
            setItems((old) =>
              (old.get(row.messageId)?.version ?? -1) > row.version
                ? old
                : new Map(old).set(row.messageId, row),
            );
          } else
            showToast({
              title:
                outcome.kind === "unknown"
                  ? "表情操作结果未知，请核实原请求。"
                  : "表情操作未成功，请重新读取后再试。",
              type: "error",
            });
        },
      )
      .catch(() => showToast({ title: "无法提交表情操作", type: "error" }));
  };
  return (
    <Context.Provider
      value={{
        roomId: bridge.roomId,
        items,
        disabled: !writable || state !== "idle",
        toggle,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useLoomReactions(message: Message) {
  const owner = useContext(Context);
  if (!owner || owner.roomId !== message.channelId) return undefined;
  const row = owner.items.get(message.id);
  return {
    canReact: !!row?.canReact && !owner.disabled,
    reactions: (row?.reactions ?? []).map((r) => ({
      emoji: r.emoji,
      count: r.count,
      reactorIds: r.actors.map((a) => a.principalId),
      reactorNames: r.actors.map((a) => a.name),
    })),
    mine: (emoji: string) =>
      !!row?.reactions.some((r) => r.emoji === emoji && r.mine),
    toggle: (emoji: string) => owner.toggle(message.id, emoji),
  };
}
