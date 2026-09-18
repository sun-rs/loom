import { useEffect, useRef, useState } from "react";
import type { AgentStateChange } from "./components/agent-state-dialog.tsx";
import { browserOpaqueId } from "./browser-opaque-id.ts";

export function useAgentStart(
  id: string | undefined,
  onChange: AgentStateChange | undefined,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(false);
  const retryKey = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    request.current = false;
    retryKey.current = undefined;
    setPending(false);
    setError(undefined);
    return () => {
      generation.current += 1;
    };
  }, [id]);
  async function start() {
    if (!id || !onChange || request.current) return;
    const current = generation.current;
    const key = retryKey.current ?? `web-agent-state-${browserOpaqueId()}`;
    retryKey.current = key;
    request.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onChange(id, "enabled", key);
      if (current === generation.current) retryKey.current = undefined;
    } catch (failure) {
      if (current === generation.current)
        setError(
          failure instanceof Error ? failure.message : "启动失败，请重试。",
        );
    } finally {
      if (current === generation.current) {
        request.current = false;
        setPending(false);
      }
    }
  }
  return { pending, error, start };
}
