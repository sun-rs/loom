import AvatarListRow from "../packages/web/src/components/ui/AvatarListRow.tsx";
import SectionHeader from "../packages/web/src/components/ui/SectionHeader.tsx";
import { computerInstances } from "./role-presence.ts";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import type { RoleListResponse } from "@rah-os/protocol";
import ComputerProfile from "./ComputerProfile.tsx";
// Structural port: locked Raft v1.21.22 $yt / zCt / MachineDetailPanel.
// Loom owns only the authenticated local inventory read; no upstream machine store.
import { useEffect, useState, type CSSProperties } from "react";
import { Monitor } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
import {
  AppShellSidebarSlot,
  AppShellMainSlot,
  SidebarRoot,
  SidebarItem,
  SidebarItemIcon,
  SidebarItemSubtitle,
  SidebarItemMeta,
  Panel,
  PanelTitle,
  Badge,
  Status,
  Separator,
  Card,
  Button,
} from "raft-ui";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { SIDEBAR_PANEL_BOUNDS } from "../packages/web/src/lib/panelBounds.ts";
import { computerStatus, computerStatusLabels } from "./computers.ts";
const mobileRow =
  "relative flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left text-foreground outline-none hover:bg-fill-pressed active:bg-fill-pressed focus-visible:shadow-[inset_0_0_0_2px_var(--foreground)] not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[63px] not-first:before:border-t not-first:before:border-line-muted";
// KeyValueRow-TXegGs9j: native label/value typography, local read-only content.
function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <div className="text-footnote font-medium text-foreground-hint">
          {label}
        </div>
      </div>
      <div className="break-all font-mono text-mono-meta text-foreground">
        {value || "未知"}
      </div>
    </div>
  );
}
export default function ComputersPage({
  client,
  controlRoomId,
  onOpenRole,
  selectedId,
  onSelect,
  onSettings,
}: {
  client: RahClient;
  controlRoomId?: string;
  onOpenRole: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSettings: () => void;
}) {
  const [instances, setInstances] = useState<RoleListResponse["instances"]>();
  useEffect(() => {
    if (!controlRoomId) return;
    const abort = new AbortController();
    void client
      .request("role.list", { controlRoomId }, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setInstances(r.instances);
      })
      .catch(() => {
        if (!abort.signal.aborted) setInstances(undefined);
      });
    return () => abort.abort();
  }, [client, controlRoomId]);
  const [inventory, setInventory] = useState<LocalRuntimeInventoryResponse>();
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const panel = useResizablePanel({
    storageKey: "loom:computersSidebarWidth",
    ...SIDEBAR_PANEL_BOUNDS,
  });
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await client.request(
          "host.runtime.list",
          {},
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) {
          setInventory(value);
          setError(false);
          setNow(Date.now());
        }
      } catch {
        if (!abort.signal.aborted) setError(true);
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 15000);
      }
    };
    void read();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      abort.abort();
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [client, reload]);
  useEffect(() => {
    if (
      !selectedId &&
      inventory &&
      window.matchMedia("(min-width: 768px)").matches
    )
      onSelect(inventory.hostId);
  }, [selectedId, inventory?.hostId, onSelect]);
  const computer = inventory?.computer;
  const name = computer?.displayName ?? "Loom 主机";
  const status = computerStatus(error ? undefined : computer, now);
  const label = computerStatusLabels[status];
  const dot = (className: string) => (
    <span
      title={label}
      className={`inline-block shrink-0 rounded-[2px] border-[1.5px] border-sticker-ink size-[9px] ${status === "online" ? "bg-presence-online" : status === "draining" ? "bg-presence-busy" : "bg-presence-offline"} ${className}`}
    />
  );
  const problem = error ? (
    <div role="alert" className="p-4 text-callout text-foreground-muted">
      无法读取计算机状态。
      <Button size="sm" variant="ghost" onClick={() => setReload((x) => x + 1)}>
        重试
      </Button>
    </div>
  ) : !inventory ? (
    <div role="status" className="p-4 text-callout text-foreground-muted">
      正在加载…
    </div>
  ) : null;
  const selected = !!inventory && selectedId === inventory.hostId;
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1"
      data-testid="loom-computers-page"
    >
      <AppShellSidebarSlot
        className={`relative min-w-0 shrink-0 flex-col md:flex md:w-[var(--computers-sidebar-width)] ${selectedId ? "hidden" : "flex w-full"}`}
        style={
          { "--computers-sidebar-width": `${panel.width}px` } as CSSProperties
        }
      >
        <SidebarRoot className="hidden h-full flex-col md:flex">
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {problem}
            {inventory && (
              <SidebarItem
                wrap
                active={selected}
                onClick={() => onSelect(inventory.hostId)}
                data-testid="computer-desktop-row"
                className="text-left max-md:h-auto max-md:min-h-11 max-md:py-[8.5px] max-md:text-body max-md:font-semibold"
              >
                <SidebarItemIcon className="relative overflow-visible">
                  <Monitor />
                  {dot("absolute -right-1 -bottom-1")}
                </SidebarItemIcon>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center">
                    <span className="min-w-0 truncate">{name}</span>
                  </div>
                  {computer?.description && (
                    <SidebarItemSubtitle className="mt-0.5">
                      {computer.description}
                    </SidebarItemSubtitle>
                  )}
                  <SidebarItemMeta className="mt-0.5 flex items-center gap-1.5">
                    {label}
                  </SidebarItemMeta>
                </div>
              </SidebarItem>
            )}
          </div>
        </SidebarRoot>
        <div
          className="flex min-h-0 flex-1 flex-col md:hidden"
          data-testid="mobile-computers-panel"
        >
          <PanelHeader
            title="计算机"
            onMobileBack={onSettings}
            mobileBackProps={{ "aria-label": "设置列表" }}
          />
          <div className="flex-1 overflow-y-auto bg-layer-panel p-4 safe-bottom mobile-nav-clearance">
            <div className="flex flex-col gap-2.5">
              {problem}
              {inventory && (
                <Card>
                  <button
                    className={mobileRow}
                    data-testid="computer-mobile-row"
                    onClick={() => onSelect(inventory.hostId)}
                  >
                    <span className="relative flex size-[35px] shrink-0 items-center justify-center rounded-sticker bg-fill-muted text-foreground-muted">
                      <Monitor size={18} aria-hidden />
                      {dot("absolute -right-1 -top-1")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="min-w-0 truncate text-body font-semibold">
                        {name}
                      </div>
                      {computer?.description && (
                        <div className="truncate text-callout text-foreground-muted">
                          {computer.description}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-mono-meta text-foreground-hint">
                        {label}
                      </div>
                    </div>
                  </button>
                </Card>
              )}
            </div>
          </div>
        </div>
        <PanelResizeHandle
          side="right"
          visibleFrom="md"
          onPointerDown={panel.handleResizeStart}
          onPointerMove={panel.handleResizeMove}
          onPointerUp={panel.handleResizeEnd}
          onPointerCancel={panel.handleResizeEnd}
        />
      </AppShellSidebarSlot>
      <AppShellMainSlot
        className={`min-w-0 md:flex ${selectedId ? "flex" : "hidden"}`}
      >
        <Panel
          edge="inset"
          className="flex min-h-0 flex-1 flex-col bg-layer-panel text-foreground"
        >
          <PanelHeader
            title={selected ? name : "计算机"}
            icon={selected ? <Monitor size={18} /> : undefined}
            iconTone="neutral"
            iconAlwaysVisible
            onMobileBack={() => onSelect(null)}
            mobileBackProps={{ "aria-label": "计算机列表" }}
          />
          {selected ? (
            <div
              className="flex-1 overflow-y-auto bg-layer-panel"
              data-testid="computer-detail"
            >
              {error && problem}
              <div className="flex items-start gap-4 px-5 py-5">
                <div className="flex size-[51px] shrink-0 items-center justify-center rounded-sticker bg-fill-muted text-foreground-muted">
                  <Monitor size={26} aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <PanelTitle className="min-w-0">{name}</PanelTitle>
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge
                      appearance="soft"
                      variant={status === "online" ? "success" : "muted"}
                      className="shrink-0"
                    >
                      <Status
                        size="md"
                        variant={status === "online" ? "success" : "default"}
                        aria-hidden
                      />
                      <span data-testid="machine-connection-status">
                        {label}
                      </span>
                    </Badge>
                  </div>
                  {computer?.hostname && (
                    <div className="truncate font-mono text-mono-meta text-foreground-hint">
                      {computer.hostname}
                    </div>
                  )}
                </div>
              </div>
              {computer && (
                <ComputerProfile
                  key={inventory.hostId}
                  client={client}
                  hostId={inventory.hostId}
                  computer={computer}
                  onSaved={() => setReload((x) => x + 1)}
                />
              )}
              <Separator />
              <div className="px-5 py-4">
                <SectionEyebrow className="mb-3">信息</SectionEyebrow>
                <div className="space-y-3">
                  <Fact label="操作系统" value={computer?.os} />
                  <Fact label="版本" value={computer?.buildVersion} />
                  <div data-testid="machine-detected-runtimes">
                    <div className="mb-1 text-footnote font-medium text-foreground-hint">
                      检测到的 CLI
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {inventory.runtimes.map((runtime, index) => (
                        <Badge
                          key={`${runtime.executable}-${index}`}
                          appearance="soft"
                          variant={runtime.available ? "information" : "muted"}
                          title={
                            runtime.resolvedExecutablePath ??
                            runtime.failureCode
                          }
                        >
                          <span
                            aria-hidden
                            className={`size-2 shrink-0 rounded-[2px] ${runtime.available ? "bg-info" : "bg-fill-muted"}`}
                          />
                          {runtime.displayName}
                          {runtime.version ? ` ${runtime.version}` : ""} ·{" "}
                          {runtime.available ? "可用" : "不可用"}
                        </Badge>
                      ))}
                    </div>
                    {inventory.runtimes.length === 0 && (
                      <p className="text-callout text-foreground-hint">
                        暂无检测结果
                      </p>
                    )}
                    <p className="mt-2 text-caption text-foreground-hint">
                      安装或更新 CLI 后需重启服务重新检测；可用不代表已登录。
                    </p>
                  </div>
                </div>
              </div>
              <Separator />
              <section className="px-5 py-4" data-testid="computer-instances">
                <SectionHeader
                  className="mb-3 flex-wrap gap-y-2"
                  label="在这台计算机上的实例"
                  count={
                    instances
                      ? computerInstances(inventory.runtimes, instances).length
                      : undefined
                  }
                />
                {!instances ? (
                  <p className="text-callout text-foreground-hint">
                    实例资料尚未读取
                  </p>
                ) : (
                  <div className="space-y-2">
                    {computerInstances(inventory.runtimes, instances).map(
                      (instance) => (
                        <AvatarListRow
                          key={instance.instanceId}
                          avatar={
                            <AvatarSlot context="list-row" type="agent" />
                          }
                          name={instance.name}
                          subtitle={
                            inventory.runtimes.find((runtime) =>
                              runtime.agentBindings.some(
                                (binding) =>
                                  binding.agentId === instance.agentId,
                              ),
                            )?.displayName
                          }
                          onClick={() => onOpenRole(instance.roleId)}
                          className="duration-300 motion-reduce:transition-none"
                        />
                      ),
                    )}
                  </div>
                )}
                {instances &&
                  !computerInstances(inventory.runtimes, instances).length && (
                    <p className="text-callout text-foreground-hint">
                      暂无绑定到这台计算机的实例
                    </p>
                  )}
              </section>
            </div>
          ) : (
            <div className="p-5 text-callout text-foreground-muted">
              {selectedId
                ? (problem ?? "该计算机不可用。")
                : "选择一台计算机查看详情。"}
            </div>
          )}
        </Panel>
      </AppShellMainSlot>
    </div>
  );
}
