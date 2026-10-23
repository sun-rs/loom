import { describePushTestFailure } from "./push-failure.ts";
import WorkspaceMute from "./WorkspaceMute";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { Button } from "raft-ui";
import { LoomNotificationStatus } from "./OfficialSettingsSections.generated.tsx";
import { LoomPushClient, browserPushPlatform } from "./push-client.ts";
import { resolveNotificationChannel } from "../packages/web/src/utils/notificationChannel.ts";
import { uiActionProps } from "./ui-action-props.ts";
export default function NotificationSettings({
  client,
  workspaceId,
  controlRoomId,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
}) {
  const channel = resolveNotificationChannel();
  const supported = channel.kind === "web-push";
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
      const value = supported
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
  const act = async (kind: "enable" | "disable" | "test") => {
    if (inFlight.current || loading || !state || !supported) return;
    inFlight.current = true;
    setBusy(kind !== "test");
    setTesting(kind === "test");
    setError("");
    setMessage("");
    let failure = "";
    try {
      if (kind === "test") {
        const result = await bridge.test();
        if (alive.current)
          setMessage(
            result.delivered > 0
              ? `推送服务已接受 ${result.delivered} 个设备的测试请求；请检查系统通知。`
              : "没有设备接受测试请求，请重新启用本浏览器通知。",
          );
      } else await bridge[kind]();
    } catch (e) {
      failure =
        kind === "test"
          ? describePushTestFailure(e)
          : e instanceof Error
            ? e.message
            : "通知操作未确认，未自动重发。";
    }
    if (alive.current) {
      await refresh();
      if (failure) setError(failure);
      setBusy(false);
      setTesting(false);
    }
    inFlight.current = false;
  };
  const confirmed = state?.subscribed === true;
  return (
    <LoomNotificationStatus
      loading={loading}
      serverConfigured={state?.supported === true}
      permission={permission}
      channel={channel}
      subscribed={confirmed}
      confirmed={confirmed}
      busy={busy}
      testing={testing}
      error={error}
      message={message}
      handleEnable={() => void act("enable")}
      handleDisable={() => void act("disable")}
      handleSendTest={() => void act("test")}
      statusLabel={
        loading
          ? "正在检查…"
          : !state
            ? "状态未知"
            : !supported
              ? "当前浏览器不可用"
              : confirmed
                ? "已启用"
                : permission === "denied"
                  ? "已被浏览器阻止"
                  : state.subscription
                    ? "浏览器订阅未登记"
                    : "未启用"
      }
      detail={
        supported
          ? "仅管理当前浏览器；测试会发送到当前用户登记的设备。站内动态与未读提醒不受此开关影响。"
          : "站内动态与未读提醒仍可使用。"
      }
    >
      <WorkspaceMute
        client={client}
        workspaceId={workspaceId}
        controlRoomId={controlRoomId}
        busy={busy || testing}
      />
      {(error || (!!state?.subscription && !confirmed)) && (
        <div className="flex gap-2">
          <Button
            {...uiActionProps.recovery}
            disabled={loading || busy || testing}
            onClick={() => void refresh()}
          >
            重新读取状态
          </Button>
          {state?.subscription && !confirmed && (
            <Button
              variant="outline"
              size="sm"
              disabled={loading || busy || testing}
              onClick={() => void act("disable")}
            >
              清理浏览器订阅
            </Button>
          )}
        </div>
      )}
    </LoomNotificationStatus>
  );
}
