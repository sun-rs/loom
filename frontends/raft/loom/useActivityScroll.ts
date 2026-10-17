import {
  activityPositionStorage,
  readActivityPosition,
  writeActivityPosition,
} from "./activity-position.ts";
import { useEffect, useRef } from "react";
import type { RahClient } from "@rah-os/client-sdk";

// Structural port: ThreadsInbox's scrollRef / restoredScrollRef / setScrollTop.
// Keep only presentation position, not upstream inbox/business state. Client
// lifetime scopes identity; switching workspace, filter or page resets position.
const positions = new WeakMap<RahClient, { scope: string; top: number }>();
export function useActivityScroll(
  client: RahClient,
  scope: string,
  enabled: boolean,
  ready: boolean,
  persist = false,
) {
  const ref = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  useEffect(() => {
    restored.current = false;
    if (enabled && positions.get(client)?.scope !== scope)
      positions.set(client, {
        scope,
        top: persist
          ? readActivityPosition(activityPositionStorage(), scope).top
          : 0,
      });
  }, [client, scope, enabled, persist]);
  useEffect(() => {
    if (!enabled || !ready || restored.current || !ref.current) return;
    const frame = requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.scrollTop = positions.get(client)?.top ?? 0;
      restored.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [client, scope, enabled, ready]);
  return {
    ref,
    onScroll: () => {
      if (enabled && ready && restored.current && ref.current) {
        positions.set(client, { scope, top: ref.current.scrollTop });
        if (persist)
          writeActivityPosition(activityPositionStorage(), scope, {
            ...readActivityPosition(activityPositionStorage(), scope),
            top: ref.current.scrollTop,
          });
      }
    },
  };
}
