import { SystemChannelSettings } from "./system-channel-settings.tsx";
import { RuntimeGuideSettingsContent } from "./runtime-guide-settings.tsx";
import { useEffect, useState } from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Workspace, MembershipRole } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  AboutSettingsContent,
  AccountSettingsContent,
  AdministrationSettingsContent,
  AppearanceSettingsContent,
  DocsSettingsContent,
  LanguageRegionSettingsContent,
  ReleaseNotesSettingsContent,
  WorkspaceProfileSettingsContent,
} from "./settings-pages.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { SettingsMobileBackProvider } from "./settings-primitives.tsx";
import { WebPushSettingsContent } from "./web-push-settings.tsx";

export type SettingsSection =
  | "account"
  | "administration"
  | "appearance"
  | "about"
  | "docs"
  | "language-region"
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
      { id: "language-region", icon: "clock-3", label: "日期与时间" },
      { id: "appearance", icon: "type", label: "外观" },
      { id: "notifications", icon: "bell", label: "通知" },
    ],
  },
  {
    label: "工作空间",
    items: [
      { id: "server", icon: "server", label: "服务器资料" },
      { id: "administration", icon: "shield-check", label: "管理" },
    ],
  },
  {
    label: "资源",
    items: [
      { id: "about", icon: "info", label: "关于" },
      { id: "docs", icon: "book-open", label: "帮助" },
      { id: "release-notes", icon: "list", label: "更新日志" },
    ],
  },
];

const SETTINGS_SECTIONS = new Set(
  SETTINGS_GROUPS.flatMap(({ items }) => items.map(({ id }) => id)),
);

function settingsSectionFromSearch(search: string): SettingsSection {
  const requested = new URLSearchParams(search).get("settingsSection");
  if (requested === "runtime") return "administration";
  return requested && SETTINGS_SECTIONS.has(requested as SettingsSection)
    ? (requested as SettingsSection)
    : "account";
}

function hasExplicitSettingsSection(search: string): boolean {
  return new URLSearchParams(search).has("settingsSection");
}

export function SettingsSurface({
  onComputers,
  canManageWorkspace,
  client,
  currentPrincipal,
  onWorkspaceUpdated,
  onSystemChannelUpdated,
  onPrincipalUpdated,
  workspace,
}: {
  onComputers?: () => void;
  agents: readonly WorkspaceAgentView[];
  canManageWorkspace: boolean;
  client: RahClient;
  currentPrincipal: Principal | undefined;
  membershipRole?: MembershipRole | undefined;
  onSystemChannelUpdated: () => void;
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
      const params = new URLSearchParams(window.location.search);
      if (params.get("settingsSection") === "runtime") {
        params.set("settingsSection", "administration");
        window.history.replaceState(null, "", `?${params}`);
      }
      setSection(settingsSectionFromSearch(window.location.search));
      setMobileIndex(!hasExplicitSettingsSection(window.location.search));
    };
    sync();
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
      <SettingsNavigation
        active={section}
        onSelect={select}
        onComputers={onComputers}
      />
      <SettingsNavigation
        active={section}
        className="rah-settings-mobile-index"
        onComputers={onComputers}
        onSelect={select}
      />
      <SettingsMobileBackProvider onBack={showMobileSettingsIndex}>
        {section === "account" ? (
          <AccountSettingsContent
            client={client}
            onUpdated={onPrincipalUpdated}
            principal={currentPrincipal}
          />
        ) : section === "language-region" ? (
          <LanguageRegionSettingsContent />
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
          <AdministrationSettingsContent>
            <SystemChannelSettings
              client={client}
              workspace={workspace}
              canManage={canManageWorkspace}
              onUpdated={onSystemChannelUpdated}
            />
            <RuntimeGuideSettingsContent client={client} />
          </AdministrationSettingsContent>
        ) : section === "about" ? (
          <AboutSettingsContent workspace={workspace} />
        ) : section === "docs" ? (
          <DocsSettingsContent />
        ) : (
          <ReleaseNotesSettingsContent />
        )}
      </SettingsMobileBackProvider>
    </main>
  );
}

function SettingsNavigation({
  onComputers,
  active,
  className,
  onSelect,
}: {
  onComputers?: (() => void) | undefined;
  active: SettingsSection;
  className?: string;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <aside
      aria-label="设置导航"
      className={`rah-settings-navigation${className ? ` ${className}` : ""}`}
    >
      <PanelHeader kind="sidebar">
        <Icon name="gear" />
        <strong>设置</strong>
      </PanelHeader>
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
            {group.label === "工作空间" && onComputers && (
              <button
                type="button"
                className="rah-interaction-row"
                onClick={onComputers}
              >
                <Icon name="monitor" />
                <span>计算机</span>
              </button>
            )}
          </section>
        ))}
      </nav>
    </aside>
  );
}
