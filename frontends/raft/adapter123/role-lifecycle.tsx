import { useState } from "react";
import { IntlProvider, useIntl } from "react-intl";
import { Button, Input } from "@botiverse/raft-ui";
import { Trash2, RotateCcw, Play, Square } from "lucide-react";
import ConfirmDialog from "../upstream/web-1.21.23/packages/web/src/components/ConfirmDialog.tsx";
import NativeReset from "../upstream/web-1.21.23/packages/web/src/components/agent/ResetAgentDialog.tsx";
import SectionEyebrow from "../upstream/web-1.21.23/packages/web/src/components/ui/SectionEyebrow.tsx";
import FormField from "../upstream/web-1.21.23/packages/web/src/components/ui/FormField.tsx";
import { useAgentStore } from "./runtime-agent-store.ts";
import { commands } from "./api.ts";
export function InstanceStartStop({
  agentId,
  onShowStopConfirm,
}: {
  agentId: string;
  onShowStopConfirm: () => void;
}) {
  const agent = useAgentStore((s) =>
    s.agents.find((a) => a.id === agentId),
  ) as any;
  const [busy, setBusy] = useState(false),
    role = !!agent?.loomRoleId,
    enabled = !!agent?.loomEnabled;
  return (
    <Button
      variant="outline"
      size="lg"
      className="flex w-full items-center justify-center gap-2"
      disabled={busy || (role && !agent.createdAgents?.length)}
      onClick={() => {
        if (enabled) onShowStopConfirm();
        else {
          setBusy(true);
          void useAgentStore
            .getState()
            .startAgent(agentId)
            .finally(() => setBusy(false));
        }
      }}
    >
      {enabled ? <Square size={14} /> : <Play size={14} />}{" "}
      {enabled
        ? role
          ? "停止所有实例"
          : "停止实例"
        : role
          ? "启用所有实例"
          : "启用实例"}
    </Button>
  );
}
export function AgentArchiveDialog({
  agent,
  onClose,
}: {
  agent: any;
  onClose: () => void;
}) {
  const role = !!agent.loomRoleId;
  return (
    <ConfirmDialog
      title={role ? "删除角色" : "移除实例"}
      message={
        role
          ? "删除角色配置后，已有实例和历史仍然保留；可在已删除分组恢复配置。"
          : "停止并移除此频道实例，保留对话历史。再次添加会创建新的实例。"
      }
      confirmLabel={role ? "删除角色" : "移除实例"}
      confirmIcon={<Trash2 size={14} />}
      confirmVariant="danger"
      onConfirm={() => useAgentStore.getState().deleteAgent(agent.id, "keep")}
      onClose={onClose}
    />
  );
}
export function AgentArchiveSection({
  agent,
  canManage,
}: {
  agent: any;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(agent.displayName || agent.name);
  return (
    <section
      className="px-5 py-4 border-t border-line-hairline"
      data-testid="loom-role-restore"
    >
      <SectionEyebrow>操作</SectionEyebrow>
      <p className="my-3 text-footnote text-foreground-muted">
        {agent.loomRoleId
          ? "角色配置已删除，已有实例和历史保留。"
          : "实例已移除；对话历史保留，重新加入会创建新实例。"}
      </p>
      {agent.loomRoleId && canManage && (
        <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
          <RotateCcw size={14} />
          恢复角色
        </Button>
      )}
      {open && (
        <ConfirmDialog
          title="恢复角色"
          plainMessage
          message={
            <FormField label="名称" htmlFor="restore-role-name">
              <Input
                id="restore-role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
          }
          confirmLabel="恢复角色"
          onConfirm={async () => {
            await commands.write("post", `/agents/${agent.id}/restore`, {
              displayName: name,
            });
            await useAgentStore.getState().loadAgents();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
export default function ResetDialog(
  props: React.ComponentProps<typeof NativeReset>,
) {
  const intl = useIntl();
  return (
    <IntlProvider
      locale={intl.locale}
      messages={{
        ...intl.messages,
        "agent.reset.restartDesc":
          "停止并重新启用实例，保留原生会话和工作区文件。",
        "agent.reset.restartModelDesc":
          "停止并重新启用实例，保留原生会话和工作区文件。",
        "agent.reset.sessionDesc":
          "下次运行从新的原生会话开始；保留冻结配置、频道历史和工作区文件，不改变启用状态。",
        "agent.reset.session": "重置会话",
      }}
    >
      <NativeReset {...props} canFullReset={false} />
    </IntlProvider>
  );
}
