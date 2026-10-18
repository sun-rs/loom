import {
  lazy,
  Suspense,
  createElement,
  type ComponentType,
  type ComponentProps,
} from "react";
import { useIntl } from "react-intl";
/** Official MainLayout.tsx PanelFallback, unchanged classes and localized label. */
function PanelFallback() {
  const { formatMessage } = useIntl();
  return (
    <div className="flex flex-1 items-center justify-center text-foreground-muted font-display text-lg font-bold">
      {formatMessage({ id: "layout.main.loading" })}
    </div>
  );
}
function nativePage<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
) {
  const Page = lazy(load);
  return (props: ComponentProps<T>) => (
    <Suspense fallback={<PanelFallback />}>
      {createElement(Page, props)}
    </Suspense>
  );
}
export const LazySettingsPage = nativePage(() => import("./SettingsPage.tsx"));
export const LazyAgentPage = nativePage(() => import("./AgentPage.tsx"));
export const LazyTasksPage = nativePage(() => import("./TasksPage.tsx"));
export const LazyMemoryPage = nativePage(() => import("./MemoryPage.tsx"));
export const LazyDiscoveryPage = nativePage(
  () => import("./DiscoveryPage.tsx"),
);
export const LazySavedPanel = nativePage(() => import("./SavedPanel.tsx"));
