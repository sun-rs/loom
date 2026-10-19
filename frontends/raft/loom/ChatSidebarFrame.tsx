import SystemNotifications from "./SystemNotifications.tsx";
// Structural port of Sidebar.tsx mobileInline / desktop root and header.
// Upstream revision/license: ../adoption.json. Loom replaces the server switcher
// with its single local Chat title; no unavailable account action is presented.
import { useEffect, useState, type ReactNode } from "react";
import { SidebarRoot } from "raft-ui";
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
      className={`relative flex h-full w-full flex-col ${desktop ? "border-r border-line-muted   bg-layer-canvas-muted " : ""} text-foreground-strong  font-display select-none`}
      data-testid={`${testIdPrefix}-root`}
    >
      {(!desktop || !hideDesktopHeader) && (
        <div
          className={
            desktop
              ? "flex shrink-0 items-center bg-layer-canvas-muted  h-panel-header border-b border-line-muted   px-5"
              : "relative flex h-panel-header shrink-0 items-center gap-3 border-b border-line-muted bg-layer-panel    px-4"
          }
          data-testid={`${testIdPrefix}-header`}
          data-loom-root-header
        >
          <h1
            className={
              desktop
                ? "font-heading truncate text-lg in-data-[theme=elegant]:text-[17px] font-bold text-foreground-strong "
                : "font-heading text-base font-bold text-foreground-strong  truncate"
            }
          >
            {title}
          </h1>
          {!desktop && title === "聊天" && (
            <>
              <div className="min-w-0 flex-1" />
              <SystemNotifications flavor="mobile-navbar" />
            </>
          )}
        </div>
      )}
      <div
        className="scrollbar-quiet min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3 mobile-nav-clearance"
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
