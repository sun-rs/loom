import { useState } from "react";
import { LoomNotificationStatus } from "./OfficialSettingsSections.generated.tsx";
import {
  localNotificationsEnabled,
  setLocalNotifications,
  supportsLocalNotifications,
  showLocalNotification,
} from "./local-notifications.ts";
export default function LocalNotificationSettings({
  workspaceId,
  roomId,
}: {
  workspaceId: string;
  roomId: string;
}) {
  const supported = supportsLocalNotifications();
  const [enabled, setEnabled] = useState(() =>
    localNotificationsEnabled(workspaceId),
  );
  const [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [permission, setPermission] = useState(
    supported ? Notification.permission : ("unsupported" as const),
  );
  const act = async (kind: "enable" | "disable" | "test") => {
    if (busy || testing) return;
    setError("");
    setMessage("");
    kind === "test" ? setTesting(true) : setBusy(true);
    try {
      if (kind === "enable") {
        const granted = await Notification.requestPermission();
        setPermission(granted);
        if (granted !== "granted")
          throw Error("请在浏览器设置中允许系统通知。");
        setLocalNotifications(workspaceId, true);
        setEnabled(true);
      } else if (kind === "disable") {
        setLocalNotifications(workspaceId, false);
        setEnabled(false);
      } else {
        await showLocalNotification({
          version: 1,
          alwaysShow: true,
          notificationId: crypto.randomUUID(),
          tag: "loom-local-test:" + crypto.randomUUID(),
          title: "Loom 本地通知测试",
          body: "此通知仅通过本机浏览器显示，未请求外部推送服务。",
          target: { kind: "room", roomId },
        });
        setMessage("浏览器已接受本地通知，请检查系统横幅或通知中心。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "本地通知未确认。");
    } finally {
      setBusy(false);
      setTesting(false);
    }
  };
  return (
    <LoomNotificationStatus
      loading={false}
      subscribed={enabled}
      confirmed={enabled && permission === "granted"}
      busy={busy}
      testing={testing}
      permission={permission}
      serverConfigured={true}
      error={error}
      message={message}
      statusLabel={enabled && permission === "granted" ? "已启用" : "未启用"}
      channel={
        supported
          ? { kind: "web-push" }
          : { kind: "unsupported", reason: "insecure-context" }
      }
      handleEnable={() => void act("enable")}
      handleDisable={() => void act("disable")}
      handleSendTest={() => void act("test")}
      detail="页面保持运行时，通过本机或局域网接收通知；不依赖外部推送服务。关闭或挂起页面后不保证送达。"
      labels={{
        "settings.notifications.sectionLabel": "本地系统通知",
        "settings.notifications.mainTitle": "私信、提及及已关注消息列的回复",
        "settings.notifications.mainDescription":
          "通过 Loom 本地连接接收，使用浏览器系统通知显示。",
        "settings.notifications.enable": "启用本地通知",
        "settings.notifications.disable": "停用本地通知",
        "settings.notifications.sendTest": "测试本地通知",
      }}
    />
  );
}
