import { useCallback, useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";

import {
  disableBrowserPush,
  enableBrowserPush,
  readBrowserPushPreference,
  readBrowserPushStatus,
  writeBrowserPushPreference,
  type BrowserPushStatus,
} from "../web-push-client.ts";
import { SettingsPage, SettingsSectionLabel } from "./settings-primitives.tsx";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";

export function WebPushSettingsContent({
  client,
  workspaceId,
}: {
  client: RahClient;
  workspaceId: string | undefined;
}) {
  const [status, setStatus] = useState<BrowserPushStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [desired, setDesired] = useState(() =>
    readBrowserPushPreference(window.localStorage),
  );
  const sidebar = useSidebarPreferences();
  const canonicalMuted = sidebar?.data?.preferences.mutedWorkspace ?? false;
  const [mutedWorkspace, setMutedWorkspace] = useState(canonicalMuted);
  useEffect(() => setMutedWorkspace(canonicalMuted), [canonicalMuted]);
  const refresh = useCallback(async () => {
    try {
      setStatus(await readBrowserPushStatus(client));
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法读取通知状态");
    }
  }, [client]);
  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);
  async function action(operation: () => Promise<BrowserPushStatus>) {
    setBusy(true);
    try {
      setStatus(await operation());
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "通知操作失败");
    } finally {
      setBusy(false);
    }
  }
  const active =
    desired && status?.browserSubscribed && status.permission === "granted";
  const stateLabel = active
    ? "已启用"
    : !desired
      ? "已停用"
      : status?.permission === "denied"
        ? "已拒绝"
        : "未决定";
  return (
    <SettingsPage icon="bell" label="通知设置" title="通知">
      <SettingsSectionLabel icon="bell">推送通知</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-push-card">
        <header>
          <div>
            <strong>私信、直接提及以及已关注消息列的回复</strong>
            <p>使用网页推送，即使标签页在后台也能收到通知。</p>
          </div>
          <span className="rah-count-badge">{stateLabel}</span>
        </header>
        {desired && status?.permission === "denied" ? (
          <p className="rah-settings-permission-note">
            浏览器权限已被拒绝。请在浏览器的站点设置中重新启用通知，然后返回此处。
          </p>
        ) : null}
        <div className="rah-settings-push-actions">
          {active ? (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                writeBrowserPushPreference(window.localStorage, false);
                setDesired(false);
                void action(() => disableBrowserPush(client));
              }}
            >
              停用推送通知
            </button>
          ) : (
            <button
              className="btn pink"
              disabled={busy}
              onClick={() => {
                writeBrowserPushPreference(window.localStorage, true);
                setDesired(true);
                void action(() => enableBrowserPush(client, true));
              }}
            >
              启用推送通知
            </button>
          )}
          {active ? (
            <button
              className="btn lime"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void client
                  .request("push.test", {})
                  .then(({ delivered }) => {
                    if (delivered === 0)
                      throw new Error("没有可投递的设备订阅");
                    setError(undefined);
                  })
                  .catch((failure: unknown) =>
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "测试通知失败",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              发送测试推送
            </button>
          ) : null}
        </div>
        <div className="rah-settings-divider" />
        <label className="rah-settings-check-row">
          <input
            checked={mutedWorkspace}
            disabled={
              !workspaceId || sidebar?.data === undefined || sidebar.pending
            }
            onChange={(event) => setMutedWorkspace(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>静音此协作空间</strong>
            <small>
              停止向当前 Human
              推送来自此协作空间的网页通知。其他协作空间不受影响。
            </small>
          </span>
        </label>
        <footer>
          <button
            className="btn pink"
            disabled={
              !workspaceId ||
              sidebar?.data === undefined ||
              sidebar.pending ||
              canonicalMuted === mutedWorkspace
            }
            onClick={() =>
              void sidebar
                ?.patch({ mutedWorkspace })
                .catch((failure) =>
                  setError(
                    failure instanceof Error ? failure.message : "保存失败",
                  ),
                )
            }
            type="button"
          >
            保存
          </button>
        </footer>
      </article>
      <article className="rah-settings-card rah-settings-secondary">
        <strong>本机投递诊断</strong>
        <p>
          权限：{status?.permission ?? "正在检查"} · 此设备订阅：
          {status?.browserSubscribed ? "存在" : "无"} · 已登记设备数：
          {status?.configuration?.subscriptionCount ?? 0}
        </p>
      </article>
      {!status?.supported && (
        <p className="rah-inline-error">
          iPhone/iPad 需通过 HTTPS 打开 RAH OS、添加到主屏幕，再从主屏幕中的 PWA
          开启通知；普通浏览器标签页不会获得 iOS Web Push。
        </p>
      )}
      {error && (
        <p className="rah-inline-error" role="alert">
          {error}
        </p>
      )}
      {sidebar?.error ? (
        <p className="rah-inline-error" role="alert">
          {sidebar.error}
        </p>
      ) : null}
    </SettingsPage>
  );
}
