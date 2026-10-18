import { uiActionProps } from "./ui-action-props.ts";
import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { ClientRunAttemptUsageGetResponse } from "@rah-os/protocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogBody,
  Button,
  Spinner,
} from "raft-ui";
import { diagnosticRows } from "./console-closeout.ts";
import { usageRows } from "./run-details.ts";
export default function RunUsageDialog({
  client,
  agentId,
  runAttemptId,
  onClose,
}: {
  client: RahClient;
  agentId: string;
  runAttemptId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ClientRunAttemptUsageGetResponse>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError("");
    void client
      .request(
        "agent.run.usage.get",
        { agentId, runAttemptId },
        { signal: abort.signal },
      )
      .then((value) => {
        if (!abort.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("用量读取失败，请重试。");
      });
    return () => abort.abort();
  }, [client, agentId, runAttemptId, retry]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>运行用量</DialogTitle>
          <DialogClose aria-label="关闭用量" />
        </DialogHeader>
        <DialogBody>
          {error ? (
            <div role="alert">
              {error}
              <Button
                {...uiActionProps.recovery}
                onClick={() => setRetry((v) => v + 1)}
              >
                重新读取用量
              </Button>
            </div>
          ) : !data ? (
            <Spinner aria-label="读取用量" />
          ) : (
            <div data-testid="loom-run-usage">
              <dl className="space-y-2 text-sm">
                {[...usageRows(data), ...diagnosticRows(data)].map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-4"
                  >
                    <dt className="truncate text-xs text-foreground-muted theme-brutal:text-black/50">
                      {row.label}
                    </dt>
                    <dd
                      className="m-0 min-w-0 text-sm tabular-nums text-foreground-strong theme-brutal:text-black break-words"
                      data-usage-field={row.label}
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {data.gaps.length > 0 && (
                <p role="note" className="mt-3 text-sm">
                  采集缺口：
                  {data.gaps
                    .map((g) => `${g.reason} × ${g.occurrences}`)
                    .join("；")}
                </p>
              )}
              <details className="mt-3 text-sm">
                <summary>
                  逐次生成
                  {data.truncated ? "（列表已截断；合计覆盖全部生成）" : ""}
                </summary>
                {data.generations.length === 0 ? (
                  <p>无记录</p>
                ) : (
                  <ol>
                    {data.generations.map((g) => (
                      <li
                        key={`${g.provider}:${g.responseId}`}
                        className="py-2 font-mono text-xs break-words"
                      >
                        {g.observedAt} · {g.provider} · 输入{" "}
                        {g.inputTokens ?? "未知"} · 缓存{" "}
                        {g.cachedInputTokens ?? "未知"} · 输出{" "}
                        {g.outputTokens ?? "未知"} · 推理{" "}
                        {g.reasoningOutputTokens ?? "未知"}
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
