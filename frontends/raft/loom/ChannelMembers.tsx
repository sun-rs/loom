import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button, Spinner } from "raft-ui";
import {
  ChannelMemberListShell,
  ChannelMemberRow,
} from "../packages/web/src/components/channel/ChannelMemberList.tsx";
import type { LoomChannelClient } from "./channel-client.ts";

function MemberList({
  bridge,
  onOpenPrivate,
  onOpenProfile,
}: {
  bridge: LoomChannelClient;
  onOpenPrivate: (id: string) => void;
  onOpenProfile?: (id: string) => void;
}) {
  const [members, setMembers] =
    useState<Awaited<ReturnType<LoomChannelClient["members"]>>>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await bridge.members(abort.signal);
        if (!abort.signal.aborted) {
          setMembers(next);
          setError(false);
        }
      } catch {
        if (!abort.signal.aborted) {
          setMembers(undefined);
          setError(true);
        }
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(poll, document.hidden ? 15000 : 3000);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [bridge]);
  if (error) return <p role="alert">成员状态暂时无法读取，正在重试。</p>;
  if (!members) return <Spinner aria-label="正在读取成员" />;
  if (!members.length) return <p>暂无成员</p>;
  return (
    <ChannelMemberListShell data-testid="loom-channel-members">
      {members.map((member) => (
        <ChannelMemberRow
          key={member.id}
          type={member.kind === "agent" ? "agent" : "human"}
          name={member.name}
          onRowClick={
            member.kind === "agent" && onOpenProfile
              ? () => onOpenProfile(member.id)
              : undefined
          }
          trailing={
            member.kind === "agent" ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={`私聊 ${member.name}`}
                onClick={() => onOpenPrivate(member.id)}
              >
                <MessageSquare size={16} />
              </Button>
            ) : undefined
          }
          secondary={<span className="whitespace-normal">{member.detail}</span>}
        />
      ))}
    </ChannelMemberListShell>
  );
}

/** Native member rows embedded in the channel settings drawer. */
export default function ChannelMembers({
  bridge,
  onOpenPrivate,
  onOpenProfile,
  onAddInstance,
}: {
  onAddInstance: (() => void) | undefined;
  bridge: LoomChannelClient;
  onOpenPrivate: (id: string) => void;
  onOpenProfile?: (id: string) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-callout font-semibold">成员</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={!onAddInstance}
          onClick={onAddInstance}
        >
          添加实例
        </Button>
      </div>
      <MemberList
        bridge={bridge}
        onOpenProfile={onOpenProfile}
        onOpenPrivate={onOpenPrivate}
      />
    </section>
  );
}
