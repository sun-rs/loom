import { useState } from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { LanDeviceSettingsContent } from "./lan-device-settings.tsx";
import { ManagedMcpSettingsContent } from "./managed-mcp-settings.tsx";

type SettingsSection = "lan-devices" | "managed-mcp";

export function SettingsSurface({
  agents,
  canReadManagedMcp,
  canWriteManagedMcp,
  client,
  consumerPrefix,
  controlRoomId,
  workspaceName,
}: {
  agents: readonly WorkspaceAgentView[];
  canReadManagedMcp: boolean;
  canWriteManagedMcp: boolean;
  client: RahClient;
  consumerPrefix: string;
  controlRoomId: string | undefined;
  workspaceName: string | undefined;
}) {
  const [section, setSection] = useState<SettingsSection>("managed-mcp");
  return (
    <main className="rah-settings-surface">
      <SettingsNavigation
        active={section}
        onSelect={setSection}
        workspaceName={workspaceName}
      />
      {section === "managed-mcp" ? (
        <ManagedMcpSettingsContent
          agents={agents}
          canRead={canReadManagedMcp}
          canWrite={canWriteManagedMcp}
          client={client}
          consumerPrefix={consumerPrefix}
          controlRoomId={controlRoomId}
        />
      ) : (
        <LanDeviceSettingsContent />
      )}
    </main>
  );
}

function SettingsNavigation({
  active,
  onSelect,
  workspaceName,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  workspaceName: string | undefined;
}) {
  return (
    <aside aria-label="设置导航" className="rah-settings-navigation">
      <header>
        <strong>设置</strong>
        <small>{workspaceName ?? "Workspace"}</small>
      </header>
      <nav>
        <SettingsNavigationGroup
          items={["账户", "语言与区域", "外观", "通知"]}
          label="个人"
        />
        <section>
          <b>工作空间</b>
          {[
            { id: "managed-mcp", label: "MCP 服务器" },
            { id: "lan-devices", label: "局域网设备" },
          ].map((item) => (
            <button
              aria-current={item.id === active ? "page" : undefined}
              className={item.id === active ? "is-active" : undefined}
              key={item.id}
              onClick={() => onSelect(item.id as SettingsSection)}
            >
              {item.label}
            </button>
          ))}
        </section>
        <SettingsNavigationGroup
          items={["服务器资料", "管理", "应用"]}
          label="管理"
        />
        <SettingsNavigationGroup
          items={["关于", "文档", "反馈", "更新日志"]}
          label="资源"
        />
      </nav>
    </aside>
  );
}

function SettingsNavigationGroup({
  items,
  label,
}: {
  items: readonly string[];
  label: string;
}) {
  return (
    <section>
      <b>{label}</b>
      {items.map((item) => (
        <button disabled key={item}>
          {item}
        </button>
      ))}
    </section>
  );
}
