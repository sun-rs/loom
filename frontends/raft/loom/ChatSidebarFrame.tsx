import { useMobilePageBack } from "./MobilePageNavigation";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader";
import SystemNotifications from "./SystemNotifications.tsx";
// Locked db5e399 generated headers; retained v1.21.26 resource shell composition.
// Native recipes own desktop/mobile header, typography and shell seams.
// Upstream revision/license: ../adoption.json. Loom replaces the server switcher
// with its single local Chat title; no unavailable account action is presented.
import { useEffect, useState, type ReactNode } from "react";
import { SidebarRoot } from "raft-ui";
import { OfficialSidebarHeader } from "./OfficialIdentityFrames.generated";
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
  const secondaryBack = useMobilePageBack();
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
      {(!desktop || !hideDesktopHeader) &&
        (!desktop && secondaryBack ? (
          <PanelHeader title={title} onMobileBack={secondaryBack} />
        ) : (
          <OfficialSidebarHeader
            desktop={desktop}
            title={title}
            testId={`${testIdPrefix}-header`}
            trailing={
              title === "聊天" ? (
                <SystemNotifications flavor="mobile-navbar" />
              ) : undefined
            }
          />
        ))}
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
