import { uiActionProps } from "./ui-action-props.ts";
import { useEffect, useState } from "react";
import { Users, MessageSquare } from "lucide-react";
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogBody,
  Spinner,
} from "raft-ui";
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

/** Official member rows and dialog primitive, without upstream agent stores or online inference. */
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
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button {...uiActionProps.panelIcon} aria-label="频道成员与状态" />
        }
      >
        <Users size={16} />
      </DialogTrigger>
      <DialogContent data-testid="loom-members-dialog">
        <DialogHeader>
          <DialogTitle>频道成员</DialogTitle>
          <DialogClose aria-label="关闭成员列表" />
        </DialogHeader>
        <DialogBody>
          <Button
            {...uiActionProps.dialogSave}
            className="mb-3"
            disabled={!onAddInstance}
            onClick={() => {
              setOpen(false);
              onAddInstance?.();
            }}
          >
            添加实例
          </Button>
          {open && (
            <MemberList
              bridge={bridge}
              onOpenProfile={
                onOpenProfile
                  ? (id) => {
                      setOpen(false);
                      onOpenProfile(id);
                    }
                  : undefined
              }
              onOpenPrivate={(id) => {
                setOpen(false);
                onOpenPrivate(id);
              }}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
