import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "raft-ui";
import type { DiscoveryRow } from "./discovery-client";
import { ActivitySwipeUndo } from "./activity-swipe-undo";
/** Explicit local binding of upstream Gt's deferred done toast to the causal activity.mark owner. */
export function useActivitySwipeUndo(
  rows: DiscoveryRow[],
  commit: (row: DiscoveryRow) => void,
) {
  const [hidden, setHidden] = useState<string>();
  const latest = useRef({ rows, commit });
  latest.current = { rows, commit };
  const toastId = useRef<string | undefined>(undefined);
  const controller = useRef<ActivitySwipeUndo<DiscoveryRow> | null>(null);
  const current = (row: DiscoveryRow) => {
    const live = latest.current.rows.find((x) => x.id === row.id);
    // Absence during pagination is not evidence of new work. Existing newer facts invalidate the gesture.
    return (
      !live ||
      live.activityFrontier?.throughSeq === row.activityFrontier?.throughSeq
    );
  };
  if (!controller.current)
    controller.current = new ActivitySwipeUndo(
      (row) => {
        if (current(row)) latest.current.commit(row);
      },
      (row) => setHidden(row?.id),
    );
  useEffect(() => {
    controller.current!.reconcile(current);
  }, [rows]);
  const done = useCallback((row: DiscoveryRow) => {
    const token = controller.current!.stage(row);
    if (toastId.current) toast.dismiss(toastId.current);
    if (document.visibilityState === "hidden") {
      controller.current!.finish(token, true);
      return;
    }
    const id = toast.success("已标记为完成", {
      action: {
        label: "撤销",
        onClick: () => {
          controller.current!.finish(token, false);
          toast.dismiss(id);
        },
      },
      onClose: () => controller.current!.finish(token, true),
    });
    toastId.current = id;
  }, []);
  useEffect(() => {
    const flush = () => controller.current!.flush();
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
      flush();
      if (toastId.current) toast.dismiss(toastId.current);
    };
  }, []);
  return { hidden, done };
}
