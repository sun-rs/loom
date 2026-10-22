import {
  Suspense,
  useEffect,
  useState,
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
  // Module cache only, not page/business state. Keep the official fallback but
  // publish a resolved module directly instead of React's Suspense reveal delay.
  let loaded: T | undefined;
  let pending: Promise<T> | undefined;
  return function DemandPage(props: ComponentProps<T>) {
    const [result, setResult] = useState<{
      page?: T;
      failed?: boolean;
      error?: unknown;
    }>(() => ({ page: loaded }));
    useEffect(() => {
      if (loaded) {
        if (!result.page) setResult({ page: loaded });
        return;
      }
      let active = true;
      pending ??= load().then((module) => (loaded = module.default));
      void pending.then(
        (page) => {
          if (active) setResult({ page });
        },
        (error) => {
          if (active) setResult({ failed: true, error });
        },
      );
      return () => {
        active = false;
      };
    }, []);
    if (result.failed) throw result.error;
    return result.page ? (
      <Suspense fallback={<PanelFallback />}>
        {createElement(result.page, props)}
      </Suspense>
    ) : (
      <PanelFallback />
    );
  };
}
export const LazySettingsPage = nativePage(() => import("./SettingsPage.tsx"));
export const LazyAgentPage = nativePage(() => import("./AgentPage.tsx"));
export const LazyTasksPage = nativePage(() => import("./TasksPage.tsx"));
export const LazyMemoryPage = nativePage(() => import("./MemoryPage.tsx"));
export const LazyDiscoveryPage = nativePage(
  () => import("./DiscoveryPage.tsx"),
);
export const LazySavedPanel = nativePage(() => import("./SavedPanel.tsx"));

export const LazyComputersPage = nativePage(
  () => import("./ComputersPage.tsx"),
);
