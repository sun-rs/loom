import type { BrowserPushStatus } from "./web-push-client.ts";

/** View-only projection. Unknown is never proof of disabled or unsupported. */
export function pushSettingsPresentation({
  status,
  checking,
  error,
  desired,
  ios,
}: {
  status?: BrowserPushStatus | undefined;
  checking: boolean;
  error?: string | undefined;
  desired: boolean;
  ios: boolean;
}) {
  const label = checking
    ? "正在检查"
    : !status
      ? error
        ? "无法检查"
        : "正在检查"
      : !desired
        ? "已停用"
        : status.permission === "unsupported"
          ? "不支持"
          : !status.supported
            ? "不可用"
            : status.permission === "denied"
              ? "已拒绝"
              : status.permission === "granted"
                ? status.browserSubscribed
                  ? "已启用"
                  : "未订阅"
                : "未决定";
  const hint =
    checking || !status
      ? undefined
      : status.permission === "unsupported"
        ? ios
          ? "iPhone/iPad 需通过 HTTPS 打开 RAH OS、添加到主屏幕，再从主屏幕中的 PWA 开启通知。"
          : "当前浏览器环境不支持网页推送。请使用支持 Web Push 的浏览器，并通过安全地址访问。"
        : !status.supported
          ? "本机服务尚未配置推送通知。"
          : undefined;
  return {
    label,
    hint,
    subscription: status ? (status.browserSubscribed ? "存在" : "无") : "未知",
    deviceCount: status?.configuration?.subscriptionCount ?? "未知",
  };
}
