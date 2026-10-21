import { OfficialComputerRow } from "./OfficialIdentityRows.generated";
import {
  OfficialComputerProfile,
  OfficialComputerRuntimes,
} from "./OfficialComputerProfile.generated";
import KeyValueRow from "@loom/raft-web-source/KeyValueRow";
import {
  OfficialListRowGroup,
  OfficialAvatarListRow,
} from "./OfficialListRows.tsx";
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
  SidebarSectionHeader,
  SidebarSectionDisclosure,
  SidebarSectionCount,
  Panel,
  PanelTitle,
  Badge,
  Status,
  Separator,
  IconTile,
  ListRow,
  ListRowBody,
  ListRowTitle,
  ListRowDescription,
  ListRowGroup,
  Button,
} from "raft-ui";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { SIDEBAR_PANEL_BOUNDS } from "../packages/web/src/lib/panelBounds.ts";
import { computerStatus, computerStatusLabels } from "./computers.ts";
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
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
            <SidebarSectionHeader data-testid="computer-section-header">
              <SidebarSectionDisclosure render={<div />} type={undefined}>
                计算机{" "}
                <SidebarSectionCount>{inventory ? 1 : 0}</SidebarSectionCount>
              </SidebarSectionDisclosure>
            </SidebarSectionHeader>
            {problem}
            {inventory && (
              <OfficialComputerRow
                machine={{
                  id: inventory.hostId,
                  name,
                  description: computer?.description,
                }}
                selected={selected}
                onClick={() => onSelect(inventory.hostId)}
                statusDot={dot("absolute -right-1 -bottom-1")}
                statusLabel={label}
              />
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
                <ListRowGroup>
                  <ListRow
                    data-testid="computer-mobile-row"
                    onClick={() => onSelect(inventory.hostId)}
                  >
                    <span className="relative shrink-0">
                      <IconTile>
                        <Monitor aria-hidden="true" />
                      </IconTile>
                      {dot("absolute -right-1 -top-1")}
                    </span>
                    <ListRowBody>
                      <ListRowTitle>{name}</ListRowTitle>
                      {computer?.description && (
                        <ListRowDescription>
                          {computer.description}
                        </ListRowDescription>
                      )}
                      <div className="flex min-w-0 items-center gap-1.5 font-mono text-mono-meta text-foreground-hint">
                        <span className="truncate">{label}</span>
                      </div>
                    </ListRowBody>
                  </ListRow>
                </ListRowGroup>
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
              <OfficialComputerProfile
                name={name}
                hostname={computer?.hostname}
                status={status}
                label={label}
              />
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
                  <KeyValueRow
                    label="操作系统"
                    value={computer?.os || "未知"}
                    mono
                    breakAll
                  />
                  <KeyValueRow
                    label="版本"
                    value={computer?.buildVersion || "未知"}
                    mono
                    breakAll
                  />
                  <div data-testid="machine-detected-runtimes">
                    <OfficialComputerRuntimes>
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
                    </OfficialComputerRuntimes>
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
                  <OfficialListRowGroup>
                    {computerInstances(inventory.runtimes, instances).map(
                      (instance) => (
                        <OfficialAvatarListRow
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
                        />
                      ),
                    )}
                  </OfficialListRowGroup>
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
