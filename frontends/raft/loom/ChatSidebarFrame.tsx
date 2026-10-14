// Structural port of Sidebar.tsx mobileInline / desktop root and header.
// Upstream revision/license: ../adoption.json. Loom replaces the server switcher
// with its single local Chat title; no unavailable account action is presented.
import { useEffect, useState, type ReactNode } from "react";
import { SidebarRoot } from "raft-ui";
export default function ChatSidebarFrame({
  title,
  testIdPrefix,
  scrollTestId,
  children,
}: {
  title: string;
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
      className={`relative flex h-full w-full flex-col ${desktop ? "border-r border-line-muted theme-brutal:border-r-2 theme-brutal:border-black bg-layer-canvas-muted theme-brutal:bg-brutal-cream" : "theme-brutal:bg-white"} text-foreground-strong theme-brutal:text-black font-display select-none`}
      data-testid={`${testIdPrefix}-root`}
    >
      <div
        className={
          desktop
            ? "flex shrink-0 items-center bg-layer-canvas-muted theme-brutal:bg-brutal-cream h-panel-header border-b border-line-muted theme-brutal:border-b-2 theme-brutal:border-black px-5"
            : "relative flex h-panel-header shrink-0 items-center gap-3 border-b border-line-muted bg-layer-panel theme-brutal:border-b-2 theme-brutal:border-black theme-brutal:bg-soft-signal px-4"
        }
        data-testid={`${testIdPrefix}-header`}
      >
        <h1
          className={
            desktop
              ? "font-heading truncate text-lg in-data-[theme=elegant]:text-[17px] font-bold text-foreground-strong theme-brutal:text-black"
              : "font-heading text-base font-bold text-foreground-strong theme-brutal:text-black truncate"
          }
        >
          {title}
        </h1>
      </div>
      <div
        className="scrollbar-quiet min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3 mobile-nav-clearance"
        data-testid={scrollTestId}
      >
        {children}
      </div>
    </SidebarRoot>
  );
}
