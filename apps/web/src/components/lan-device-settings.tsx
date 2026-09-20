import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { useEffect, useMemo, useState } from "react";

import {
  LanAccessClient,
  type LanAccessSession,
  type LanDevice,
  type LanPairingCode,
} from "../lan-access-client.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { SettingsPageHeader } from "./settings-primitives.tsx";
import { formatRahDateTime } from "../date-time-presentation.ts";

export function LanDeviceSettingsContent() {
  const client = useMemo(() => new LanAccessClient(), []);
  const [session, setSession] = useState<LanAccessSession>();
  const [devices, setDevices] = useState<LanDevice[]>([]);
  const [invite, setInvite] = useState<LanPairingCode>();
  const [revokeTarget, setRevokeTarget] = useState<LanDevice>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void client
      .session(controller.signal)
      .then(async (currentSession) => {
        if (controller.signal.aborted) return;
        setSession(currentSession);
        if (currentSession.available && currentSession.authenticated === true) {
          setDevices(await client.listDevices(controller.signal));
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client]);

  const issuePairingCode = () => {
    if (pending) return;
    setPending(true);
    setCopied(false);
    setError(undefined);
    void client
      .issuePairingCode()
      .then(setInvite)
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setPending(false));
  };

  const revokeDevice = async (device: LanDevice) => {
    setPending(true);
    setError(undefined);
    try {
      await client.revokeDevice(device.deviceId);
      setDevices((current) =>
        current.map((candidate) =>
          candidate.deviceId === device.deviceId
            ? { ...candidate, revokedAt: new Date().toISOString() }
            : candidate,
        ),
      );
      setRevokeTarget(undefined);
      if (
        session?.available === true &&
        session.authenticated === true &&
        session.device.deviceId === device.deviceId
      ) {
        window.location.assign("/_rah/pair");
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const copyInvite = () => {
    if (invite === undefined || copied) return;
    void navigator.clipboard
      .writeText(invite.code)
      .then(() => setCopied(true))
      .catch((caught) => setError(errorMessage(caught)));
  };

  const activeDevices = devices.filter(({ revokedAt }) => revokedAt === null);
  return (
    <>
      <section className="rah-settings-content">
        <SettingsPageHeader
          badge={
            <span className="rah-count-badge">{activeDevices.length}</span>
          }
          icon="monitor"
          title="局域网设备"
          action={
            <button
              className="btn"
              disabled={
                pending ||
                session?.available !== true ||
                session.authenticated !== true
              }
              onClick={issuePairingCode}
            >
              生成配对码
            </button>
          }
        />
        <div className="rah-settings-scroll rah-scroll-main">
          <p className="rah-settings-intro">
            管理可通过 HTTPS 访问此 RAH Core 的浏览器与 PWA。设备会话属于 LAN
            edge；Room、Task 和 Agent 状态仍只由 Kernel 持有。
          </p>
          {error === undefined ? null : (
            <div className="rah-inline-error" role="alert">
              {error}
            </div>
          )}
          {loading ? (
            <DeviceEmptyState detail="正在检查当前入口…" title="加载中" />
          ) : session?.available !== true ? (
            <DeviceEmptyState
              detail="当前是 loopback 工作台。使用 start:lan-workbench 的正式 HTTPS 入口后才会开放设备配对。"
              title="LAN 设备管理未启用"
            />
          ) : session.authenticated !== true ? (
            <DeviceEmptyState
              detail="此浏览器尚未完成设备配对。"
              title="需要配对"
            />
          ) : activeDevices.length === 0 ? (
            <DeviceEmptyState
              detail="当前没有有效设备会话。"
              title="暂无设备"
            />
          ) : (
            <div className="rah-device-server-list">
              {devices.map((device) => {
                const current = session.device.deviceId === device.deviceId;
                return (
                  <article
                    className="rah-device-server-card"
                    key={device.deviceId}
                  >
                    <header>
                      <span className="rah-device-server-icon">
                        <Icon name="monitor" />
                      </span>
                      <div>
                        <h2>{device.displayName}</h2>
                        <p>{device.deviceId}</p>
                      </div>
                      <span
                        className={`rah-device-state is-${device.revokedAt === null ? "enabled" : "disabled"}`}
                      >
                        {device.revokedAt === null
                          ? current
                            ? "当前设备"
                            : "已配对"
                          : "已撤销"}
                      </span>
                      <button
                        className="btn"
                        disabled={pending || device.revokedAt !== null}
                        onClick={() => setRevokeTarget(device)}
                      >
                        撤销
                      </button>
                    </header>
                    <div className="rah-device-tool-summary">
                      <b>最近访问 {formatTimestamp(device.lastSeenAt)}</b>
                      <span>配对于 {formatTimestamp(device.createdAt)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {invite === undefined ? null : (
            <section
              className="rah-device-executor-inventory"
              aria-live="polite"
            >
              <header>
                <h2>一次性配对码</h2>
                <span>有效至 {formatTimestamp(invite.expiresAt)}</span>
              </header>
              <div>
                <b>{invite.code}</b>
                <button className="btn" onClick={copyInvite}>
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </section>
          )}
        </div>
      </section>
      {revokeTarget === undefined ? null : (
        <RevokeDeviceDialog
          device={revokeTarget}
          onClose={() => setRevokeTarget(undefined)}
          onConfirm={() => revokeDevice(revokeTarget)}
          pending={pending}
        />
      )}
    </>
  );
}

function RevokeDeviceDialog({
  device,
  onClose,
  onConfirm,
  pending,
}: {
  device: LanDevice;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  pending: boolean;
}) {
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  return (
    <DialogLayer className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭撤销设备窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-revoke-device-title"
        aria-modal="true"
        className="rah-dialog rah-members-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-revoke-device-title">撤销设备</h2>
            <p>{device.displayName}</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span aria-hidden="true" className="rah-close-glyph">
              ×
            </span>
          </button>
        </header>
        <div className="rah-members-body">
          <p>
            该设备的全部浏览器会话将立即失效，不影响 Room 和正在运行的 Agent。
          </p>
        </div>
        <footer>
          <button className="btn" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-red"
            disabled={pending}
            onClick={() => void onConfirm()}
          >
            {pending ? "正在撤销…" : "确认撤销"}
          </button>
        </footer>
      </section>
    </DialogLayer>
  );
}

function DeviceEmptyState({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div className="rah-device-empty-state">
      <Icon name="monitor" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function formatTimestamp(value: string): string {
  return formatRahDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "LAN 设备操作失败";
}
