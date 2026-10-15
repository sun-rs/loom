import { useRouteIntentOwner } from "./useIntentRoute.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShellMainSlot, Panel, Card, Button, Input } from "raft-ui";
import { Settings, SlidersHorizontal } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type { RuntimeSettings } from "@rah-os/protocol";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import SectionHeader from "../packages/web/src/components/ui/SectionHeader.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
import { saveConcurrency } from "./control-actions.ts";
/** SettingsPanel content shell + native settings card/form; no upstream account state. */
export default function SettingsPage({
  client,
  workspaceId,
  controlRoomId,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
}) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [base, setBase] = useState<RuntimeSettings>(),
    [latest, setLatest] = useState<RuntimeSettings>();
  const [value, setValue] = useState(""),
    [notice, setNotice] = useState(""),
    [readError, setReadError] = useState("");
  const [needsRead, setNeedsRead] = useState(false),
    [reload, setReload] = useState(0);
  const baseRef = useRef<RuntimeSettings>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const data = await client.request(
          "runtime.settings.read",
          {},
          { signal: abort.signal },
        );
        if (
          abort.signal.aborted ||
          (baseRef.current && data.revision < baseRef.current.revision)
        )
          return;
        setLatest(data);
        setReadError("");
        if (!baseRef.current) {
          baseRef.current = data;
          setBase(data);
          setValue(String(data.maxConcurrentRuns));
          setNeedsRead(false);
        }
      } catch {
        if (!abort.signal.aborted) {
          setLatest(undefined);
          setReadError("无法读取当前设置，请重新读取。");
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 15000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, reload]);
  const cap = Number(value),
    valid =
      /^\d+$/.test(value) && Number.isInteger(cap) && cap >= 1 && cap <= 64;
  const stale = base && latest && base.revision !== latest.revision;
  const busy = state !== "idle";
  return (
    <AppShellMainSlot data-testid="loom-settings-page">
      <Panel
        edge="attached"
        className="flex min-h-0 flex-1 flex-col bg-layer-canvas-muted text-foreground-strong"
      >
        <PanelHeader
          title="设置"
          icon={<Settings size={18} />}
          iconBg="bg-primary-soft text-foreground-strong theme-brutal:bg-soft-signal theme-brutal:text-black"
        />
        <div className="flex-1 overflow-y-auto bg-layer-panel px-5 py-4 text-foreground-strong mobile-nav-clearance theme-brutal:bg-white theme-brutal:text-black">
          <div className="mb-6">
            <SectionHeader
              className="mb-3"
              icon={<SlidersHorizontal size={16} />}
              label="运行设置"
            />
            <Card className="border-line-muted bg-layer-panel p-4 shadow-raft-sm theme-brutal:border-2 theme-brutal:border-black theme-brutal:bg-white theme-brutal:shadow-brutal-sm">
              <p className="mb-3 text-xs leading-5 text-foreground-muted">
                通常保持默认即可。并发调整只影响之后开始的工作，不中断正在运行的实例。
              </p>
              {!base && !readError && <p role="status">加载中…</p>}
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!base || busy || !valid || stale || needsRead || !latest)
                    return;
                  setNotice("");
                  setError("");
                  void saveConcurrency(
                    manager,
                    base.revision,
                    cap,
                    (result) => {
                      if (result.kind === "ok") {
                        baseRef.current = result.result;
                        setBase(result.result);
                        setLatest(result.result);
                        setValue(String(result.result.maxConcurrentRuns));
                        setNotice("已保存；只影响之后的调度。");
                      } else if (result.kind === "rejected") {
                        setNeedsRead(true);
                        setError(
                          "未确认本次保存。请重新读取当前生效值，确认后再修改。",
                        );
                      }
                    },
                  );
                }}
              >
                <FormField
                  label="本机同时运行上限"
                  labelStyle="plain"
                  size="compact"
                >
                  <Input
                    aria-label="本机同时运行上限"
                    type="number"
                    min={1}
                    max={64}
                    step={1}
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setNotice("");
                    }}
                    disabled={!base || busy}
                    className="w-full text-sm"
                  />
                </FormField>
                {base && !valid && <p role="alert">请输入 1–64 的整数。</p>}
                {stale && (
                  <p role="alert">设置已在别处更新；请重新读取后再修改。</p>
                )}
                {readError && <p role="alert">{readError}</p>}
                <div className="flex gap-3">
                  <Button
                    variant="accent"
                    size="sm"
                    type="submit"
                    disabled={
                      busy ||
                      !base ||
                      !latest ||
                      !valid ||
                      Boolean(stale) ||
                      needsRead ||
                      cap === base.maxConcurrentRuns
                    }
                  >
                    保存
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      baseRef.current = undefined;
                      setBase(undefined);
                      setLatest(undefined);
                      setNotice("");
                      setError("");
                      setReload((v) => v + 1);
                    }}
                  >
                    重新读取
                  </Button>
                </div>
                {notice && (
                  <p role="status" className="text-sm">
                    {notice}
                  </p>
                )}
                {state === "unknown" ? (
                  <div role="alert" className="text-sm">
                    未收到保存结果。重新读取会放弃核实这次保存，以当前生效配置为准；不会再次提交。
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        manager.writes.abandon();
                        baseRef.current = undefined;
                        setBase(undefined);
                        setLatest(undefined);
                        setNeedsRead(true);
                        setReload((v) => v + 1);
                      }}
                    >
                      放弃核实并重新读取
                    </Button>
                  </div>
                ) : (
                  <OperationStatus manager={manager} error={error} />
                )}
              </form>
            </Card>
          </div>
          {latest && (
            <details className="text-sm">
              <summary className="cursor-pointer font-bold">
                当前生效配置
              </summary>
              <dl className="mt-3 space-y-2 font-mono text-xs">
                {[
                  ["配置修订", latest.revision],
                  ["同时运行上限", latest.maxConcurrentRuns],
                  ["同时启动上限", latest.maxConcurrentStarts],
                  ["启动最小间隔（毫秒）", latest.minStartIntervalMs],
                  ["实例互相唤醒上限", latest.wakeGuard.instanceChainLimit],
                  [
                    "无进展告警（分钟）",
                    latest.watchdog.noProgressWarnMs / 60000,
                  ],
                  [
                    "排队无进展终止（分钟）",
                    latest.watchdog.queuedStallTerminateMs / 60000,
                  ],
                  ["单次运行上限（分钟）", latest.watchdog.maxRunMs / 60000],
                  ["创建实例时预热", latest.prewarm.enabled ? "开启" : "关闭"],
                  [
                    "服务启动时预热近期实例（小时）",
                    latest.prewarm.recentActiveHours,
                  ],
                  ...latest.runtimes.map((r) => [
                    `${r.runtimeProfileId} 并发上限`,
                    `${r.maxConcurrentRuns}（供给上限 ${r.offerMaxConcurrent}）`,
                  ]),
                ].map(([label, v]) => (
                  <div
                    key={label}
                    className="flex flex-wrap justify-between gap-2"
                  >
                    <dt>{label}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      </Panel>
    </AppShellMainSlot>
  );
}
