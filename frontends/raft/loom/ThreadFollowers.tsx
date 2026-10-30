import { useLoomAvatarMap } from "./AppearanceRuntime.tsx";
import { roleAvatarUrl } from "./profile-avatar.ts";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal } from "@rah-os/protocol";
import { toast } from "raft-ui";
import ThreadAgentFollowers from "../packages/web/src/components/thread/ThreadAgentFollowers.tsx";
import type { ThreadAgentFollowerRoster } from "../packages/web/src/store/threadAgentFollowerStore.ts";
import { ThreadFollowersClient } from "./thread-followers-client.ts";
type Host = {
  client: RahClient;
  roomId: string;
  threadId: string;
  members: Principal[];
  onOpenProfile?: (member: Principal) => void;
};
const Context = createContext<Host | null>(null);
export default function ThreadFollowers(props: Host) {
  return (
    <Context.Provider value={props}>
      <ThreadAgentFollowers threadChannelId={props.threadId} variant="header" />
    </Context.Provider>
  );
}
export function useLoomFollowerProfile() {
  const host = useContext(Context);
  return (_kind: string, id: string) => {
    const member = host?.members.find(
      (m) => m.kind === "agent" && m.principalId === id,
    );
    if (member) host?.onOpenProfile?.(member);
  };
}
export function useLoomThreadFollowers(threadId: string) {
  const host = useContext(Context);
  const avatars = useLoomAvatarMap();
  if (!host || host.threadId !== threadId)
    throw Error("消息列关注成员作用域缺失");
  const bridge = useMemo(
    () => new ThreadFollowersClient(host.client, host.roomId, threadId),
    [host.client, host.roomId, threadId],
  );
  const [roster, setRoster] = useState<ThreadAgentFollowerRoster>();
  const current = useRef<ThreadFollowersClient | undefined>(bridge);
  const readGeneration = useRef(0);
  current.current = bridge;
  const members = useRef(host.members);
  members.current = host.members;
  const busy = useRef(false);
  const load = async (_ids?: string[], _force?: boolean) => {
    const generation = ++readGeneration.current;
    try {
      const data = await bridge.read();
      const agents = data.agentParticipantIds.map((id) => {
        const member = members.current.find(
          (m) => m.kind === "agent" && m.principalId === id,
        );
        if (!member) throw Error("成员信息尚未同步");
        return {
          id,
          name: member.handle,
          displayName: member.displayName ?? member.handle,
          status: "unknown",
          avatarUrl: roleAvatarUrl(member.avatarKey ?? null),
          canRemove: true,
        };
      });
      if (current.current === bridge && generation === readGeneration.current)
        setRoster({
          agents,
          canManage: data.canManage,
          loaded: true,
          loading: false,
          error: false,
        });
    } catch {
      if (current.current === bridge && generation === readGeneration.current)
        setRoster({
          agents: [],
          canManage: false,
          loaded: false,
          loading: false,
          error: true,
        });
    }
  };
  useEffect(() => {
    current.current = bridge;
    setRoster(undefined);
    void load();
    const timer = setInterval(() => {
      if (!busy.current && !document.hidden) void load();
    }, 10000);
    return () => {
      clearInterval(timer);
      if (current.current === bridge) current.current = undefined;
    };
  }, [bridge]);
  return {
    roster: roster
      ? {
          ...roster,
          agents: roster.agents.map((agent) => ({
            ...agent,
            avatarUrl: Object.hasOwn(avatars, agent.id)
              ? roleAvatarUrl(avatars[agent.id] ?? null)
              : agent.avatarUrl,
          })),
        }
      : roster,
    load,
    remove: async (_threadId: string, id: string) => {
      if (
        busy.current ||
        !roster?.canManage ||
        !roster.agents.some((a) => a.id === id)
      )
        throw Error("当前不能修改关注成员");
      busy.current = true;
      try {
        const result = await bridge.remove(id);
        return result.removed ? result.undoToken : null;
      } finally {
        await load();
        busy.current = false;
      }
    },
    restore: async (_threadId: string, id: string, token: string) => {
      if (busy.current) return false;
      busy.current = true;
      try {
        const restored = await bridge.restore(id, token);
        if (!restored) toast.error("撤销未生效，可能已过期或成员状态已变化。");
        return restored;
      } catch {
        toast.error("撤销结果未确认，正在重新读取；不会自动重发。");
        return false;
      } finally {
        await load();
        busy.current = false;
      }
    },
  };
}
