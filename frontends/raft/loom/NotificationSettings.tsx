import { useEffect, useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { Button, Checkbox, Separator } from "raft-ui";
import {
  localNotificationsEnabled,
  setLocalNotifications,
  supportsLocalNotifications,
  showLocalNotification,
} from "./local-notifications.ts";
import { setSystemNotifications } from "./notification-preferences.ts";
import { LoomNotificationStatus } from "./OfficialSettingsSections.generated.tsx";
import { LoomPushClient, browserPushPlatform } from "./push-client.ts";
import { resolveNotificationChannel } from "../packages/web/src/utils/notificationChannel.ts";
import { uiActionProps } from "./ui-action-props.ts";
export default function NotificationSettings({
  client,
  workspaceId,
  controlRoomId,
  workspaceLink,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  workspaceLink?: import("react").ReactNode;
}) {
  const channel = resolveNotificationChannel();
  const supported = supportsLocalNotifications();
  const pushSupported = channel.kind === "web-push";
  const [localEnabled, setLocalEnabled] = useState(() =>
    localNotificationsEnabled(workspaceId),
  );
  useEffect(() => {
    const changed = () =>
      setLocalEnabled(localNotificationsEnabled(workspaceId));
    changed();
    window.addEventListener("storage", changed);
    window.addEventListener("loom-local-notifications", changed);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("loom-local-notifications", changed);
    };
  }, [workspaceId]);
  const bridge = useMemo(
    () => new LoomPushClient(client, browserPushPlatform),
    [client],
  );
  const [state, setState] =
    useState<Awaited<ReturnType<LoomPushClient["read"]>>>();
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(supported ? Notification.permission : "unsupported");
  const alive = useRef(false),
    inFlight = useRef(false),
    generation = useRef(0);
  const refresh = async () => {
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const value = pushSupported
        ? await bridge.read()
        : await client
            .request("push.configuration", {})
            .then((c) => ({ ...c, subscription: null, subscribed: false }));
      if (alive.current && ticket === generation.current) {
        setState(value);
        setError("");
        setPermission(supported ? Notification.permission : "unsupported");
      }
    } catch {
      if (alive.current && ticket === generation.current) {
        setState(undefined);
        setError("无法核实本浏览器通知状态，请重新读取。");
      }
    } finally {
      if (alive.current && ticket === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      ++generation.current;
    };
  }, [bridge]);
  const act = async (
    kind: "enable" | "disable" | "test" | "background-on" | "background-off",
  ) => {
    if (inFlight.current || !supported) return;
    if (kind.startsWith("background-") && (loading || !state || !pushSupported))
      return;
    inFlight.current = true;
    setBusy(kind !== "test");
    setTesting(kind === "test");
    setError("");
    setMessage("");
    let failure = "";
    try {
      if (kind === "test") {
        await showLocalNotification({
          version: 1,
          alwaysShow: true,
          notificationId: crypto.randomUUID(),
          tag: "loom-test:" + crypto.randomUUID(),
          title: "Loom 通知测试",
          body: "此通知通过本机浏览器显示，未请求外部推送服务。",
          target: { kind: "room", roomId: controlRoomId },
        });
        if (alive.current)
          setMessage("浏览器已接受通知，请检查系统横幅或通知中心。");
      } else if (kind === "background-on") {
        if (!localEnabled || !state?.supported) return;
        await bridge.enable();
      } else if (kind === "background-off") {
        await bridge.disable();
      } else {
        await setSystemNotifications(kind === "enable", {
          requestPermission: async () => {
            const value = await Notification.requestPermission();
            if (alive.current) setPermission(value);
            return value;
          },
          setLocal: (value) => setLocalNotifications(workspaceId, value),
          stopBackground: () => bridge.disable(),
        });
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : "通知操作未确认，未自动重发。";
    } finally {
      if (alive.current) {
        if (kind !== "test") await refresh();
        if (failure) setError(failure);
        setBusy(false);
        setTesting(false);
      }
      inFlight.current = false;
    }
  };
  const backgroundEnabled = state?.subscribed === true;
  const enabled = localEnabled || backgroundEnabled;
  return (
    <>
      <LoomNotificationStatus
        labels={{
          "settings.notifications.sectionLabel": "系统通知",
          "settings.notifications.mainDescription":
            "接收私信、提及及已关注消息列的回复。",
          "settings.notifications.enable": "启用通知",
          "settings.notifications.disable": "停用通知",
          "settings.notifications.sendTest": "发送测试通知",
        }}
        loading={false}
        serverConfigured={true}
        permission={permission}
        channel={
          supported
            ? { kind: "web-push" }
            : { kind: "unsupported", reason: "insecure-context" }
        }
        subscribed={enabled}
        confirmed={enabled && permission === "granted"}
        busy={busy}
        testing={testing}
        error={error}
        message={message}
        handleEnable={() => void act("enable")}
        handleDisable={() => void act("disable")}
        handleSendTest={() => void act("test")}
        statusLabel={
          !supported
            ? "当前浏览器不可用"
            : permission === "denied"
              ? "已被浏览器阻止"
              : enabled
                ? "已启用"
                : "未启用"
        }
        detail="页面运行时优先通过本机或局域网接收通知。仅管理当前浏览器，站内动态与未读提醒不受影响。"
      >
        <Separator />
        <details className="text-footnote">
          <summary className="cursor-pointer font-semibold text-foreground-muted">
            高级
          </summary>
          <div className="space-y-3 mt-3">
            <label className="flex items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={backgroundEnabled}
                disabled={
                  loading ||
                  busy ||
                  testing ||
                  !pushSupported ||
                  !state ||
                  (!backgroundEnabled && (!localEnabled || !state.supported))
                }
                onCheckedChange={(checked) =>
                  void act(checked ? "background-on" : "background-off")
                }
              />
              <span className="min-w-0">
                <span className="block text-subhead font-semibold">
                  页面关闭后仍接收通知
                </span>
                <span className="block text-footnote text-foreground-muted mt-0.5">
                  需要连接浏览器厂商的外部推送服务。新设备默认关闭；已有订阅保持原状态。
                </span>
              </span>
            </label>
            {loading && (
              <p className="text-foreground-muted">正在检查后台通知状态…</p>
            )}
            {!pushSupported && (
              <p className="text-foreground-muted">
                当前浏览器不支持后台推送。
              </p>
            )}
            {state && !state.supported && (
              <p className="text-foreground-muted">服务器尚未配置后台推送。</p>
            )}
            {(!state || (!!state.subscription && !backgroundEnabled)) && (
              <div className="flex gap-2">
                <Button
                  {...uiActionProps.recovery}
                  disabled={loading || busy || testing}
                  onClick={() => void refresh()}
                >
                  重新读取状态
                </Button>
                {state?.subscription && !backgroundEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || busy || testing}
                    onClick={() => void act("background-off")}
                  >
                    清理浏览器订阅
                  </Button>
                )}
              </div>
            )}
          </div>
        </details>
      </LoomNotificationStatus>
      {workspaceLink}
    </>
  );
}
