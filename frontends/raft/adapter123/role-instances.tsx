import { useState } from "react";
import {
  Button,
  ListRowGroup,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  Select,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectList,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from "@botiverse/raft-ui";
import { Plus } from "lucide-react";
import { FieldSelectTrigger } from "../upstream/web-1.21.23/packages/web/src/components/agent/StableField.tsx";
import { MachineAgentRow } from "../upstream/web-1.21.23/packages/web/src/components/machine/MachineAgentRow.tsx";
import SectionHeader from "../upstream/web-1.21.23/packages/web/src/components/ui/SectionHeader.tsx";
import FormField from "../upstream/web-1.21.23/packages/web/src/components/ui/FormField.tsx";
import { useChannelStore } from "../upstream/web-1.21.23/packages/web/src/store/channelStore.ts";
import { useAppNavigate } from "../upstream/web-1.21.23/packages/web/src/hooks/useAppNavigate.ts";
import {
  selectAgentDisplayState,
  useAgentStore,
} from "./runtime-agent-store.ts";
import { commands } from "./api.ts";
export default function RoleInstances({ agent }: { agent: any }) {
  const [open, setOpen] = useState(false),
    [channel, setChannel] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const all = useAgentStore((s) => s.agents),
    activities = useAgentStore((s) => s.agentActivities),
    channels = useChannelStore((s) => s.channels),
    nav = useAppNavigate();
  void activities;
  if (!agent.loomRoleId) return null;
  const ids = new Set((agent.createdAgents ?? []).map((a: any) => a.id)),
    instances = all.filter((a) => ids.has(a.id) && !a.deletedAt),
    available = channels.filter((c) => !c.archivedAt && c.type === "channel"),
    items = available.map((c) => ({ value: c.id, label: c.name }));
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      await commands.write("post", `/channels/${channel}/agents`, {
        agentId: agent.id,
      });
      await useAgentStore.getState().loadAgents();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="px-5 py-4 border-t border-line-hairline"
      data-testid="loom-role-instances"
    >
      <SectionHeader
        label="实例"
        count={instances.length}
        className="mb-3 flex-wrap gap-y-2"
        action={
          !agent.deletedAt ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setChannel(available[0]?.id ?? "");
                setError("");
                setOpen(true);
              }}
            >
              <Plus size={16} />
              实例
            </Button>
          ) : undefined
        }
      />
      {instances.length ? (
        <ListRowGroup>
          {instances.map((instance) => (
            <MachineAgentRow
              key={instance.id}
              agent={instance}
              displayState={selectAgentDisplayState(
                useAgentStore.getState(),
                instance.id,
                instance,
              )}
              selectionMode={false}
              selected={false}
              canManageMachines={false}
              onToggleSelection={() => {}}
              onOpenAgent={(id) => nav.toAgent(id)}
            />
          ))}
        </ListRowGroup>
      ) : (
        <p className="text-footnote text-foreground-muted">暂无实例</p>
      )}
      {open && (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value && !busy) setOpen(false);
          }}
        >
          <DialogContent
            className="max-w-md"
            data-testid="loom-create-instance"
          >
            <DialogHeader>
              <DialogTitle>添加实例到频道</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <FormField label="频道">
                <Select
                  chrome="field"
                  value={channel}
                  onValueChange={(value) => setChannel(value ?? "")}
                  items={items}
                >
                  <FieldSelectTrigger className="w-full">
                    <SelectValue placeholder="选择频道" />
                    <SelectIcon />
                  </FieldSelectTrigger>
                  <SelectContent>
                    <SelectList>
                      {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          <SelectItemText>{item.label}</SelectItemText>
                          <SelectItemIndicator />
                        </SelectItem>
                      ))}
                    </SelectList>
                  </SelectContent>
                </Select>
              </FormField>
              {!available.length && (
                <p className="text-footnote text-foreground-muted">
                  请先创建频道
                </p>
              )}
              {error && (
                <p role="alert" className="text-footnote text-danger-strong">
                  {error}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                variant="ghost"
                size="lg"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={busy || !channel}
                onClick={() => void create()}
              >
                {busy ? "添加中…" : "添加实例"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
