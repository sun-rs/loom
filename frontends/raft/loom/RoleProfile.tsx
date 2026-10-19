import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  RoleTemplate,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
import { Button } from "raft-ui";
import { Pencil } from "lucide-react";
import { roleFormFrom } from "@rah-os/client-core/role-form";
import { ProfileFact } from "./AgentProfileFacts.tsx";
import { uiActionProps } from "./ui-action-props.ts";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
export default function RoleProfile({
  client,
  role,
  disabled,
  onEdit,
}: {
  client: RahClient;
  role: RoleTemplate;
  disabled: boolean;
  onEdit: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<LocalRuntimeInventoryResponse>();
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request("host.runtime.list", {}, { signal: abort.signal })
      .then((v) => {
        if (!abort.signal.aborted) setInventory(v);
      })
      .catch(() => {
        if (!abort.signal.aborted) setInventory(undefined);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client]);
  const form = roleFormFrom(role.configuration);
  const runtime = inventory?.runtimes.find(
    (r) => r.runtimeOfferId === form.runtimeOfferId,
  );
  const model = runtime?.modelBindingDescriptors.find(
    (b) => b.modelBindingId === form.modelBindingId,
  );
  const { formatShortDateTime } = useTimeFormatter();
  return (
    <div data-testid="loom-role-profile" className="space-y-5 font-sans">
      <dl className="space-y-3">
        <ProfileFact label="名称">{role.configuration.displayName}</ProfileFact>
        <ProfileFact label="CLI">
          {runtime?.displayName ?? (loading ? "读取中…" : "当前配置不可用")}
        </ProfileFact>
        <ProfileFact label="模型">
          {(model?.displayName ?? model?.modelId ?? form.modelBindingId) ||
            "未指定"}
        </ProfileFact>
        <ProfileFact label="推理强度">{form.reasoning || "未指定"}</ProfileFact>
        <ProfileFact label="创建时间">
          {formatShortDateTime(role.createdAt)}
        </ProfileFact>
        <ProfileFact label="角色 Prompt">
          <span className="whitespace-pre-wrap">{form.instructions}</span>
        </ProfileFact>
      </dl>
      <Button {...uiActionProps.formSave} disabled={disabled} onClick={onEdit}>
        <Pencil size={14} />
        编辑配置
      </Button>
    </div>
  );
}
