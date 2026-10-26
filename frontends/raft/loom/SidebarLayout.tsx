import {
  CurrentColumnResize,
  useCurrentColumnWidth,
} from "../upstream/published-2026-10-26/column-resize.js";
import {
  createContext,
  useContext,
  useEffect,
  type ComponentProps,
} from "react";
import { AppShellRoot, AppShellSidebarSlot } from "raft-ui";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import { useSidebarPreference } from "./sidebar-preference.ts";
import { toggleSidebar } from "./OfficialSidebarToggle.generated.js";
const Layout = createContext({ destination: "", collapsed: false });
/** Native shell owns measurement, transition and main offset. This binds device preference and active page identity. */
export function LoomShellRoot({
  destination,
  ...props
}: ComponentProps<typeof AppShellRoot> & { destination: string }) {
  const desktop = useMediaQuery("(min-width: 768px)");
  const hidden = useSidebarPreference((s) => s.sidebarHidden);
  const enabled =
    desktop &&
    ["channels", "agents", "computers", "settings"].includes(destination);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      if (
        enabled &&
        event.key === "\\" &&
        (mac ? event.metaKey : event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
  return (
    <Layout.Provider value={{ destination, collapsed: enabled && hidden }}>
      <AppShellRoot
        {...props}
        sidebarCollapsible={enabled}
        sidebarOpen={!enabled || !hidden}
        onSidebarOpenChange={(open) => {
          if (open === hidden) toggleSidebar();
        }}
      />
    </Layout.Provider>
  );
}
export function LoomSidebarSlot({
  page,
  ...props
}: ComponentProps<typeof AppShellSidebarSlot> & { page: string }) {
  const layout = useContext(Layout);
  return (
    <AppShellSidebarSlot
      {...props}
      id={layout.destination === page ? "app-sidebar" : undefined}
      inert={layout.collapsed || undefined}
      className={`${props.className ?? ""} group-data-[state=expanded]/app-shell:md:z-2`}
    />
  );
}

/** Current official column mechanism; existing shell preference owns collapse/focus restoration. */
export function useSidebarColumn() {
  return { width: useCurrentColumnWidth("sidebar") };
}
export function SidebarResize({ testId }: { testId: string }) {
  const hidden = useSidebarPreference((s) => s.sidebarHidden);
  return (
    <CurrentColumnResize
      column="sidebar"
      edge="right"
      visibleFrom="md"
      label="调整侧栏宽度"
      data-testid={testId}
      snap={{
        kind: "collapse",
        snapped: hidden,
        onSnappedChange(value) {
          if (useSidebarPreference.getState().sidebarHidden !== value)
            toggleSidebar();
          return true;
        },
      }}
    />
  );
}
