import { LoomWorkingSummary } from "./AppearanceRuntime.tsx";
import { layoutQueries } from "./adaptive-layout.ts";
import { useMobilePageBack } from "./MobilePageNavigation";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader";
import SystemNotifications from "./SystemNotifications.tsx";
// Locked db5e399 generated headers; retained v1.21.26 resource shell composition.
// Native recipes own desktop/mobile header, typography and shell seams.
// Raft UI 0.52 list cells/section headers own horizontal insets; do not add legacy px-2.
// Upstream revision/license: ../adoption.json. Loom replaces the server switcher
// with its single local Chat title; no unavailable account action is presented.
import { useEffect, useState, type ReactNode } from "react";
import { SidebarRoot } from "raft-ui";
import { SIDEBAR_SCROLL_139_CLASS } from "./OfficialSidebar139.generated.js";
import { OfficialSidebarHeader } from "./OfficialIdentityFrames.generated";
export default function ChatSidebarFrame({
  title,
  hideDesktopHeader = false,
  fillContent = false,
  bottomSlot,
  notice,
  testIdPrefix,
  scrollTestId,
  children,
}: {
  title: string;
  hideDesktopHeader?: boolean;
  fillContent?: boolean;
  bottomSlot?: ReactNode;
  notice?: ReactNode;
  testIdPrefix: string;
  scrollTestId: string;
  children: ReactNode;
}) {
  const secondaryBack = useMobilePageBack();
  const [desktop, setDesktop] = useState(
    () => window.matchMedia(layoutQueries.dual).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(layoutQueries.dual);
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
      {(!desktop || !hideDesktopHeader) &&
        (!desktop && secondaryBack ? (
          <PanelHeader title={title} onMobileBack={secondaryBack} />
        ) : (
          <OfficialSidebarHeader
            desktop={desktop}
            title={!desktop && title === "聊天" ? "Loom" : title}
            testId={`${testIdPrefix}-header`}
            trailing={
              title === "聊天" ? (
                <>
                  <LoomWorkingSummary onFrame />
                  <SystemNotifications flavor="mobile-navbar" />
                </>
              ) : undefined
            }
          />
        ))}
      {notice}
      <div
        className={`${SIDEBAR_SCROLL_139_CLASS} min-h-0 ${fillContent ? "flex flex-col" : ""}`}
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
