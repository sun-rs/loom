import { useMemo, useState } from "react";
import type { SystemNotice } from "./attention-presentation.ts";

// Bounded presentation preferences, never messages, tokens, read frontiers or business state.
export function useSystemNotices(
  notices: SystemNotice[],
  principalId?: string,
  workspaceId?: string,
) {
  const key = `rah.system-notice-dismissals:${principalId ?? "none"}:${workspaceId ?? "none"}`;
  const stored = useMemo(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(value)
        ? value
            .filter(
              (id): id is string => typeof id === "string" && id.length < 600,
            )
            .slice(-100)
        : [];
    } catch {
      return [];
    }
  }, [key]);
  const [state, setState] = useState<{ key: string; ids: string[] }>();
  const ids = state?.key === key ? state.ids : stored;
  return {
    notices: notices.filter((notice) => !ids.includes(notice.id)),
    dismiss(id: string) {
      if (!notices.some((notice) => notice.id === id)) return;
      const next = [...new Set([...ids, id])].slice(-100);
      setState({ key, ids: next });
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* preference can be volatile */
      }
    },
  };
}
