import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { LoomNotificationStatus } from "loom-native-appearance";
/** Read-only capability view. A daemon subscription count never proves this browser subscribed. */
export default function NotificationSettings({
  client,
}: {
  client: RahClient;
}) {
  const [state, setState] = useState({
    loading: true,
    supported: false,
    error: "",
  });
  useEffect(() => {
    let active = true;
    setState({ loading: true, supported: false, error: "" });
    client.request("push.configuration", {}).then(
      (r) => {
        if (active)
          setState({ loading: false, supported: r.supported, error: "" });
      },
      () => {
        if (active)
          setState({
            loading: false,
            supported: false,
            error: "无法读取通知服务状态，请重新打开此页重试。",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [client]);
  const reason = !window.isSecureContext
    ? "insecure-context"
    : !("Notification" in window)
      ? "no-notification-api"
      : !("serviceWorker" in navigator)
        ? "no-service-worker"
        : !("PushManager" in window)
          ? "no-push-manager"
          : undefined;
  const permission = reason ? "unsupported" : Notification.permission;
  return (
    <LoomNotificationStatus
      loading={state.loading}
      serverConfigured={state.supported}
      permission={permission}
      channel={reason ? { kind: "unsupported", reason } : { kind: "web-push" }}
      error={state.error}
      statusLabel={
        state.loading
          ? "正在检查…"
          : state.error
            ? "状态未知"
            : reason
              ? "当前浏览器不可用"
              : "订阅尚未接入"
      }
      detail={
        reason
          ? "站内动态与未读提醒仍可使用。"
          : "本机浏览器的推送订阅与通知跳转尚未接入；此处不会申请通知权限或发送测试推送。"
      }
    />
  );
}
