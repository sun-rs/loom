import { useCallback, useEffect, useRef, useState } from "react";
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
import { createLatestRequest } from "../latest-request.ts";
import { pushSettingsPresentation } from "../web-push-presentation.ts";

export function WebPushSettingsContent({
  client,
  workspaceId,
}: {
  client: RahClient;
  workspaceId: string | undefined;
}) {
  const [status, setStatus] = useState<BrowserPushStatus>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const reads = useRef(createLatestRequest());
  const writing = useRef(false);
  const [desired, setDesired] = useState(() =>
    readBrowserPushPreference(window.localStorage),
  );
  const sidebar = useSidebarPreferences();
  const canonicalMuted = sidebar?.data?.preferences.mutedWorkspace ?? false;
  const [mutedWorkspace, setMutedWorkspace] = useState(canonicalMuted);
  useEffect(() => setMutedWorkspace(canonicalMuted), [canonicalMuted]);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const ticket = reads.current.begin();
    setChecking(true);
    try {
      const next = await readBrowserPushStatus(client);
      if (!ticket.current()) return;
      setStatus(next);
      setError(undefined);
    } catch (failure) {
      if (!ticket.current()) return;
      setStatus(undefined);
      setError(failure instanceof Error ? failure.message : "无法读取通知状态");
    } finally {
      if (ticket.current()) setChecking(false);
    }
  }, [client]);
  useEffect(() => {
    writing.current = false;
    setBusy(false);
    setStatus(undefined);
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      reads.current.cancel();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);
  async function action(
    operation: () => Promise<BrowserPushStatus | undefined>,
    successMessage?: string,
  ) {
    if (writing.current) return;
    const ticket = reads.current.begin();
    writing.current = true;
    setChecking(false);
    setBusy(true);
    setSuccess(undefined);
    try {
      const next = await operation();
      if (!ticket.current()) return;
      if (next) setStatus(next);
      setError(undefined);
      setSuccess(successMessage);
    } catch (failure) {
      if (!ticket.current()) return;
      setError(failure instanceof Error ? failure.message : "通知操作失败");
    } finally {
      if (ticket.current()) {
        writing.current = false;
        setBusy(false);
      }
    }
  }
  const active =
    desired && status?.browserSubscribed && status.permission === "granted";
  const presentation = pushSettingsPresentation({
    status,
    checking,
    error,
    desired,
    ios:
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  });
  const disabled = busy || checking || !status?.supported;
  return (
    <SettingsPage icon="bell" label="通知设置" title="通知">
      <SettingsSectionLabel icon="bell">推送通知</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-push-card">
        <header>
          <div>
            <strong>私信、直接提及以及已关注消息列的回复</strong>
            <p>使用网页推送，即使标签页在后台也能收到通知。</p>
          </div>
          <span className="rah-count-badge" aria-live="polite">
            {presentation.label}
          </span>
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
              disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
              onClick={() => {
                void action(async () => {
                  const { delivered } = await client.request("push.test", {});
                  if (delivered === 0) throw new Error("没有可投递的设备订阅");
                  return undefined;
                }, "已提交测试推送，请检查系统通知。");
              }}
            >
              发送测试推送
            </button>
          ) : null}
        </div>
        {success ? (
          <p className="rah-settings-success" role="status">
            {success}
          </p>
        ) : null}
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
          权限：{status?.permission ?? (checking ? "正在检查" : "未知")} ·
          此设备订阅：
          {presentation.subscription} · 已登记设备数：{presentation.deviceCount}
        </p>
        <button
          className="btn"
          disabled={busy || checking}
          onClick={() => void refresh()}
          type="button"
        >
          重新检查通知
        </button>
      </article>
      {presentation.hint && (
        <p className="rah-inline-error">{presentation.hint}</p>
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
