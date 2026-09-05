import { createContext, useContext } from "react";

import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";

const SettingsMobileBackContext = createContext<(() => void) | undefined>(
  undefined,
);

export function SettingsMobileBackProvider({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <SettingsMobileBackContext.Provider value={onBack}>
      {children}
    </SettingsMobileBackContext.Provider>
  );
}

export function SettingsPageHeader({
  action,
  badge,
  icon,
  title,
}: {
  action?: React.ReactNode;
  badge?: React.ReactNode;
  icon: string;
  title: string;
}) {
  const onMobileBack = useContext(SettingsMobileBackContext);
  return (
    <PanelHeader
      kind="surface"
      className="rah-settings-page-head"
      data-slock-settings-tab={title}
      data-testid="settings-panel-header"
    >
      <div className="rah-settings-page-title">
        {onMobileBack ? (
          <PanelHeaderAction
            aria-label="返回设置"
            className="rah-settings-mobile-back"
            onClick={onMobileBack}
            title="返回设置"
            type="button"
          >
            <Icon name="arrow-left" />
          </PanelHeaderAction>
        ) : null}
        <PanelHeaderIcon name={icon} className="rah-settings-page-icon" />
        <h1 className="rah-panel-title">{title}</h1>
        {badge}
      </div>
      {action}
    </PanelHeader>
  );
}

export function SettingsPage({
  children,
  icon,
  label,
  title,
}: {
  children: React.ReactNode;
  icon: string;
  label?: string;
  title: string;
}) {
  return (
    <section className="rah-settings-content" aria-label={label ?? title}>
      <SettingsPageHeader icon={icon} title={title} />
      <div className="rah-settings-scroll">{children}</div>
    </section>
  );
}

export function SettingsSectionLabel({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: string;
}) {
  return (
    <h2 className="rah-settings-section-label">
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </h2>
  );
}
