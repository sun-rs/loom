import { useEffect, useState } from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Workspace } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import { LanDeviceSettingsContent } from "./lan-device-settings.tsx";
import { ManagedMcpSettingsContent } from "./managed-mcp-settings.tsx";
import {
  AboutSettingsContent,
  AccountSettingsContent,
  AdministrationSettingsContent,
  AppearanceSettingsContent,
  DocsSettingsContent,
  FeedbackSettingsContent,
  ReleaseNotesSettingsContent,
  WorkspaceProfileSettingsContent,
} from "./settings-pages.tsx";
import { Icon } from "./icon.tsx";
import { SettingsMobileBackProvider } from "./settings-primitives.tsx";
import { WebPushSettingsContent } from "./web-push-settings.tsx";

export type SettingsSection =
  | "account"
  | "administration"
  | "appearance"
  | "about"
  | "docs"
  | "feedback"
  | "lan-devices"
  | "managed-mcp"
  | "notifications"
  | "release-notes"
  | "server";

type SettingsItem = {
  icon: string;
  id: SettingsSection;
  label: string;
  localExtension?: boolean;
};

const SETTINGS_GROUPS: readonly {
  label: string;
  items: readonly SettingsItem[];
}[] = [
  {
    label: "个人",
    items: [
      { id: "account", icon: "user-round", label: "账户" },
      { id: "appearance", icon: "type", label: "外观" },
      { id: "notifications", icon: "bell", label: "通知" },
    ],
  },
  {
    label: "工作空间",
    items: [
      { id: "server", icon: "server", label: "服务器资料" },
      { id: "administration", icon: "shield-check", label: "管理" },
      { id: "managed-mcp", icon: "blocks", label: "MCP 服务器" },
      {
        id: "lan-devices",
        icon: "monitor",
        label: "局域网设备",
        localExtension: true,
      },
    ],
  },
  {
    label: "资源",
    items: [
      { id: "about", icon: "info", label: "关于" },
      { id: "docs", icon: "book-open", label: "文档" },
      { id: "feedback", icon: "message-square", label: "反馈" },
      { id: "release-notes", icon: "list", label: "更新日志" },
    ],
  },
];

const SETTINGS_SECTIONS = new Set(
  SETTINGS_GROUPS.flatMap(({ items }) => items.map(({ id }) => id)),
);

function settingsSectionFromSearch(search: string): SettingsSection {
  const requested = new URLSearchParams(search).get("settingsSection");
  return requested && SETTINGS_SECTIONS.has(requested as SettingsSection)
    ? (requested as SettingsSection)
    : "account";
}

function hasExplicitSettingsSection(search: string): boolean {
  return new URLSearchParams(search).has("settingsSection");
}

export function SettingsSurface({
  agents,
  canManageWorkspace,
  canReadManagedMcp,
  canWriteManagedMcp,
  client,
  consumerPrefix,
  controlRoomId,
  currentPrincipal,
  onWorkspaceUpdated,
  onPrincipalUpdated,
  workspace,
}: {
  agents: readonly WorkspaceAgentView[];
  canManageWorkspace: boolean;
  canReadManagedMcp: boolean;
  canWriteManagedMcp: boolean;
  client: RahClient;
  consumerPrefix: string;
  controlRoomId: string | undefined;
  currentPrincipal: Principal | undefined;
  onWorkspaceUpdated: (workspace: Workspace) => void;
  onPrincipalUpdated: (principal: Principal) => void;
  workspace: Workspace | undefined;
}) {
  const [section, setSection] = useState<SettingsSection>(() =>
    settingsSectionFromSearch(window.location.search),
  );
  const [mobileIndex, setMobileIndex] = useState(
    () => !hasExplicitSettingsSection(window.location.search),
  );
  useEffect(() => {
    const sync = () => {
      setSection(settingsSectionFromSearch(window.location.search));
      setMobileIndex(!hasExplicitSettingsSection(window.location.search));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const select = (next: SettingsSection) => {
    setSection(next);
    setMobileIndex(false);
    const params = new URLSearchParams(window.location.search);
    params.set("surface", "settings");
    params.set("settingsSection", next);
    window.history.pushState(null, "", `?${params}`);
  };
  const showMobileSettingsIndex = () => {
    setMobileIndex(true);
    const params = new URLSearchParams(window.location.search);
    params.set("surface", "settings");
    params.delete("settingsSection");
    window.history.pushState(null, "", `?${params}`);
  };
  return (
    <main
      className="rah-settings-surface"
      data-mobile-index={mobileIndex || undefined}
    >
      <SettingsNavigation active={section} onSelect={select} />
      <SettingsNavigation
        active={section}
        className="rah-settings-mobile-index"
        onSelect={select}
      />
      <SettingsMobileBackProvider onBack={showMobileSettingsIndex}>
        {section === "account" ? (
          <AccountSettingsContent
            client={client}
            onUpdated={onPrincipalUpdated}
            principal={currentPrincipal}
          />
        ) : section === "appearance" ? (
          <AppearanceSettingsContent />
        ) : section === "notifications" ? (
          <WebPushSettingsContent
            client={client}
            workspaceId={workspace?.workspaceId}
          />
        ) : section === "server" ? (
          <WorkspaceProfileSettingsContent
            canManage={canManageWorkspace}
            client={client}
            onUpdated={onWorkspaceUpdated}
            workspace={workspace}
          />
        ) : section === "administration" ? (
          <AdministrationSettingsContent
            agents={agents}
            principal={currentPrincipal}
          />
        ) : section === "managed-mcp" ? (
          <ManagedMcpSettingsContent
            agents={agents}
            canRead={canReadManagedMcp}
            canWrite={canWriteManagedMcp}
            client={client}
            consumerPrefix={consumerPrefix}
            controlRoomId={controlRoomId}
          />
        ) : section === "lan-devices" ? (
          <LanDeviceSettingsContent />
        ) : section === "about" ? (
          <AboutSettingsContent workspace={workspace} />
        ) : section === "docs" ? (
          <DocsSettingsContent />
        ) : section === "feedback" ? (
          <FeedbackSettingsContent />
        ) : (
          <ReleaseNotesSettingsContent />
        )}
      </SettingsMobileBackProvider>
    </main>
  );
}

function SettingsNavigation({
  active,
  className,
  onSelect,
}: {
  active: SettingsSection;
  className?: string;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <aside
      aria-label="设置导航"
      className={`rah-settings-navigation${className ? ` ${className}` : ""}`}
    >
      <header>
        <strong>设置</strong>
      </header>
      <nav>
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.label}>
            <b>{group.label}</b>
            {group.items.map((item) => (
              <button
                aria-current={item.id === active ? "page" : undefined}
                className={`rah-interaction-row${item.id === active ? " is-active" : ""}`}
                data-local-extension={item.localExtension || undefined}
                key={item.id}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.localExtension ? <small>本地</small> : null}
              </button>
            ))}
          </section>
        ))}
      </nav>
    </aside>
  );
}
