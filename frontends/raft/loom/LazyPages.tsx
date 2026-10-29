import PageLoadRecovery from "./PageLoadRecovery.tsx";
import { isDynamicImportFailure } from "../packages/web/src/utils/dynamicImportRecovery.ts";
import {
  Suspense,
  useEffect,
  useState,
  createElement,
  type ComponentType,
  type ComponentProps,
} from "react";
import { useIntl } from "react-intl";
import { TasksPanelRoot } from "raft-ui";
import { OfficialTasksHeader } from "./OfficialTasksHeader.generated";
/** Official MainLayout.tsx PanelFallback, unchanged classes and localized label. */
function PanelFallback() {
  const { formatMessage } = useIntl();
  return (
    <div className="flex flex-1 items-center justify-center text-foreground-muted font-display text-lg font-bold">
      {formatMessage({ id: "layout.main.loading" })}
    </div>
  );
}
function TasksLoading() {
  const { formatMessage } = useIntl();
  return (
    <TasksPanelRoot
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="tasks-page-loading"
    >
      <OfficialTasksHeader
        meta={formatMessage({ id: "layout.main.loading" })}
      />
      <PanelFallback />
    </TasksPanelRoot>
  );
}
function nativePage<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  Fallback: ComponentType = PanelFallback,
) {
  // Module cache only, not page/business state. Keep the official fallback but
  // publish a resolved module directly instead of React's Suspense reveal delay.
  let loaded: T | undefined;
  let pending: Promise<T> | undefined;
  const preload = () => {
    if (pending) return pending;
    const attempt = (pending = load().then(
      (module) => (loaded = module.default),
    ));
    // A failed speculation must not pin a transient transport error forever.
    // No automatic retry: a later explicit navigation/import may try again.
    void attempt.catch(() => {
      if (pending === attempt) pending = undefined;
    });
    return attempt;
  };
  function DemandPage(props: ComponentProps<T>) {
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
      void preload().then(
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
    if (result.failed) {
      if (isDynamicImportFailure(result.error))
        return <PageLoadRecovery error={result.error} />;
      throw result.error;
    }
    return result.page ? (
      <Suspense fallback={<Fallback />}>
        {createElement(result.page, props)}
      </Suspense>
    ) : (
      <Fallback />
    );
  }
  return Object.assign(DemandPage, { preload });
}
export const LazySettingsPage = nativePage(() => import("./SettingsPage.tsx"));
export const LazyAgentPage = nativePage(() => import("./AgentPage.tsx"));
export const LazyTasksPage = nativePage(
  () => import("./TasksPage.tsx"),
  TasksLoading,
);
export const LazyMemoryPage = nativePage(() => import("./MemoryPage.tsx"));
export const LazyDiscoveryPage = nativePage(
  () => import("./DiscoveryPage.tsx"),
);
export const LazySavedPanel = nativePage(() => import("./SavedPanel.tsx"));

export const LazyComputersPage = nativePage(
  () => import("./ComputersPage.tsx"),
);
