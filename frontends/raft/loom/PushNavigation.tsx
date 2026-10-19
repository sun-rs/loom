import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { RahClient } from "@rah-os/client-sdk";
import {
  NavigationTargetSchema,
  type NavigationTarget,
} from "@rah-os/protocol";
import { Button } from "raft-ui";
import Banner from "../packages/web/src/components/ui/Banner.tsx";
import { hasRouteBoundIntent } from "./useIntentRoute.ts";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { pushTargetParams } from "./push-navigation.ts";
/** Official worker-message listener pattern, using the authenticated Loom navigation owner. */
export default function PushNavigation({ client }: { client: RahClient }) {
  const location = useLocation(),
    [params, setParams] = useSearchParams();
  const current = useRef(location);
  current.current = location;
  const [pending, setPending] = useState<NavigationTarget>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const raw = params.get("push");
    if (!raw) return;
    try {
      if (raw.length > 4096) throw Error();
      setPending(NavigationTargetSchema.parse(JSON.parse(raw)));
      setError("");
    } catch {
      setPending(undefined);
      setError("通知目标无效，未跳转。");
    }
  }, [params.get("push")]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const receive = (event: MessageEvent) => {
      const source = event.source as ServiceWorker | null;
      if (
        !source?.scriptURL ||
        source.scriptURL !==
          new URL("/loom-push-sw.js", locationOrigin()).href ||
        event.data?.type !== "LOOM_PUSH_NAVIGATE"
      )
        return;
      const result = NavigationTargetSchema.safeParse(event.data.target);
      if (result.success) {
        setPending(result.data);
        setError("");
      }
    };
    navigator.serviceWorker.addEventListener("message", receive);
    return () =>
      navigator.serviceWorker.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (!pending) return;
    if (hasRouteBoundIntent() || hasUnresolvedIntents()) {
      setError("请先处理当前未决操作，再打开通知。");
      return;
    }
    const started = current.current,
      abort = new AbortController();
    client
      .request(
        "navigation.resolve",
        { target: pending },
        { signal: abort.signal },
      )
      .then(({ target }) => {
        if (abort.signal.aborted) return;
        if (
          current.current !== started ||
          hasRouteBoundIntent() ||
          hasUnresolvedIntents()
        ) {
          setError("当前页面已变化，请点击打开通知。");
          return;
        }
        const next = pushTargetParams(target);
        setPending(undefined);
        setError("");
        setParams(next, { replace: !!params.get("push"), state: null });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("通知位置无法读取或已不可访问，未跳转。");
      });
    return () => abort.abort();
  }, [client, pending, retry]);
  if (!error) return null;
  return (
    <Banner
      intent="warning"
      density="sm"
      role="alert"
      data-testid="push-navigation-error"
    >
      {error}
      {pending && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRetry((n) => n + 1)}
        >
          打开通知
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setPending(undefined);
          setError("");
          if (params.has("push")) {
            const next = new URLSearchParams(params);
            next.delete("push");
            setParams(next, { replace: true });
          }
        }}
      >
        关闭
      </Button>
    </Banner>
  );
}
function locationOrigin() {
  return window.location.origin;
}
