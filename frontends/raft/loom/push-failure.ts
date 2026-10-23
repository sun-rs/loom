import { RahClientError } from "@rah-os/client-sdk";

/** Never expose raw push endpoint, provider body or credentials in UI errors. */
export function describePushTestFailure(error: unknown): string {
  let reason = "未能确认发送结果";
  if (error instanceof Error && error.name === "TimeoutError") {
    reason = "等待超过 20 秒，发送结果未确认（通知仍可能稍后到达）";
  } else if (error instanceof RahClientError) {
    if (error.status === 401 || error.status === 403)
      reason = "登录状态或访问权限校验未通过，请刷新页面后检查";
    else if (error.code === "invalid_response") reason = "服务响应格式异常";
    else reason = `服务返回 HTTP ${error.status}，发送结果未确认`;
  } else if (error instanceof TypeError) {
    reason = "网络连接中断或浏览器未能读取响应，发送结果未确认";
  }
  return `测试推送：${reason}。未自动重发；请先检查系统通知，避免重复发送。`;
}
