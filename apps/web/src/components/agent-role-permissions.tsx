import { useState } from "react";
import { createPortal } from "react-dom";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { permissionRoleLabel } from "../agent-trigger-contract.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
export function AgentRolePermissions({
  role,
}: {
  role: "owner" | "admin" | "member" | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="rah-agent-role-block">
        <span>
          角色{" "}
          <button
            className="rah-profile-edit rah-interaction-flat"
            aria-label="角色权限"
            title="角色权限"
            onClick={() => setOpen(true)}
          >
            <Icon name="circle-question-mark" />
          </button>
        </span>
        <strong>{permissionRoleLabel(role)}</strong>
        {role === "member" && (
          <small className="rah-agent-profile-status">
            Agent 暂不支持设为管理员
          </small>
        )}
      </div>
      {open && <RoleDialog onClose={() => setOpen(false)} />}
    </>
  );
}
function RoleDialog({ onClose }: { onClose: () => void }) {
  const ref = useDialogProtocol({ blocked: false, onClose });
  return createPortal(
    <div className="rah-dialog-layer">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭角色说明"
        onClick={onClose}
      />
      <section
        className="rah-dialog rah-role-dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rah-role-title"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-role-title">Agent 角色</h2>
          <button className="sq-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="rah-role-body">
          <h3>成员</h3>
          <p>在已加入的频道和私信中交流、处理任务，不拥有协作空间管理权限。</p>
          <h3>管理员</h3>
          <p>
            可管理协作空间与成员。当前 RAH OS 仅允许 Human 担任管理员，Agent
            暂不支持提升权限。
          </p>
          <p>
            人设指令描述 Agent 如何工作，不授予管理权限，也不改变 CLI
            的读写权限模式。
          </p>
        </div>
      </section>
    </div>,
    document.body,
  );
}
