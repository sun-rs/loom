import FeedbackUnreadDot from "../../feedback/FeedbackUnreadDot";
import type { ReactNode } from "react";
import { SidebarItem, SidebarGroupLabel, SidebarItemContent, SidebarItemTitle } from "raft-ui";

export interface SettingsSidebarItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  href?: string;
  testId?: string;
}

export interface SettingsSidebarGroup {
  label: string;
  items: SettingsSidebarItem[];
}

/** The shared settings rows used inside the canonical AppShell sidebar.
 *  Rows are RUI SidebarItem so selected/hover geometry follows the theme
 *  recipe (elegant rounded borderless, brutal hard pink block). External
 *  links keep anchor semantics via `render`. */
export default function SettingsSidebarList({
  groups,
  activeId,
}: {
  groups: SettingsSidebarGroup[];
  activeId: string | null;
}) {
  return (
    <div data-testid="settings-sidebar-list">
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <div key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          {group.items.map((item) => {
            const selected = activeId === item.id;
            return (
              <SidebarItem
                key={item.id}
                active={selected}
                render={item.href ? (
                  // The render literal is empty by design: SidebarItem merges
                  // its children into this element. aria-label mirrors the
                  // visible label for the anchor-has-content rule.
                  <a href={item.href} target="_blank" rel="noopener noreferrer" aria-label={item.label} />
                ) : (
                  <button type="button" onClick={item.onClick} aria-label={item.label} />
                )}
                data-testid={item.testId}
              >
                {item.icon}
                <SidebarItemContent className="items-center"><SidebarItemTitle>{item.label}</SidebarItemTitle></SidebarItemContent>
                {item.id === "feedback" && <FeedbackUnreadDot className="ml-auto" />}
              </SidebarItem>
            );
          })}
        </div>
      ))}
    </div>
  );
}
