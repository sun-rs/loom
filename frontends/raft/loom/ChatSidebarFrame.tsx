import SystemNotifications from "./SystemNotifications.tsx";
// Current v1.21.22 Sidebar (sbt) composition; see page-adoption.json.
// Native recipes own desktop/mobile header, typography and shell seams.
// Upstream revision/license: ../adoption.json. Loom replaces the server switcher
// with its single local Chat title; no unavailable account action is presented.
import { useEffect, useState, type ReactNode } from "react";
import {
  SidebarRoot,
  SidebarHeader,
  SidebarHeaderTitle,
  PanelSectionHeader,
  PanelHeaderContent,
  PanelTitle,
} from "raft-ui";
export default function ChatSidebarFrame({
  title,
  hideDesktopHeader = false,
  bottomSlot,
  testIdPrefix,
  scrollTestId,
  children,
}: {
  title: string;
  hideDesktopHeader?: boolean;
  bottomSlot?: ReactNode;
  testIdPrefix: string;
  scrollTestId: string;
  children: ReactNode;
}) {
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <SidebarRoot
      className="relative flex h-full w-full flex-col font-sans text-foreground select-none"
      data-testid={`${testIdPrefix}-root`}
    >
      {desktop ? (
        !hideDesktopHeader && (
          <SidebarHeader
            data-testid={`${testIdPrefix}-header`}
            data-loom-root-header
          >
            <SidebarHeaderTitle render={<h1 />} className="min-w-0 flex-1">
              {title}
            </SidebarHeaderTitle>
          </SidebarHeader>
        )
      ) : (
        <PanelSectionHeader
          data-testid={`${testIdPrefix}-header`}
          data-loom-root-header
        >
          <PanelHeaderContent>
            <PanelTitle render={<h1 />}>{title}</PanelTitle>
          </PanelHeaderContent>
          {title === "聊天" && <SystemNotifications flavor="mobile-navbar" />}
        </PanelSectionHeader>
      )}
      <div
        className={`scrollbar-quiet min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2 mobile-nav-clearance ${hideDesktopHeader ? "pt-2" : "pt-1"}`}
        data-testid={scrollTestId}
      >
        {children}
      </div>
      {desktop && bottomSlot ? (
        <div className="pointer-events-none shrink-0">{bottomSlot}</div>
      ) : null}
    </SidebarRoot>
  );
}
