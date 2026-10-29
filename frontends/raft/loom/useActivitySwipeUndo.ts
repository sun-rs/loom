import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "raft-ui";
import type { DiscoveryRow } from "./discovery-client";
import { ActivitySwipeUndo } from "./activity-swipe-undo";
/** One UI-only undo owner for done/unfollow, matching Web1.21.38 deferred actions. */
type PendingActivityAction = { row: DiscoveryRow; kind: "done" | "unfollow" };
export function useActivitySwipeUndo(
  rows: DiscoveryRow[],
  commit: (row: DiscoveryRow) => void,
  unfollow?: (row: DiscoveryRow) => void,
) {
  const [hidden, setHidden] = useState<string>();
  const latest = useRef({ rows, commit, unfollow });
  latest.current = { rows, commit, unfollow };
  const toastId = useRef<string | undefined>(undefined);
  const controller = useRef<ActivitySwipeUndo<PendingActivityAction> | null>(
    null,
  );
  const current = ({ row }: PendingActivityAction) => {
    const live = latest.current.rows.find((x) => x.id === row.id);
    // Absence during pagination is not evidence of new work. Existing newer facts invalidate the gesture.
    return (
      !live ||
      live.activityFrontier?.throughSeq === row.activityFrontier?.throughSeq
    );
  };
  if (!controller.current)
    controller.current = new ActivitySwipeUndo(
      (action) => {
        if (current(action)) {
          if (action.kind === "unfollow") latest.current.unfollow?.(action.row);
          else latest.current.commit(action.row);
        }
      },
      (action) => setHidden(action?.row.id),
    );
  useEffect(() => {
    controller.current!.reconcile(current);
  }, [rows]);
  const stage = useCallback((row: DiscoveryRow, kind: "done" | "unfollow") => {
    const token = controller.current!.stage({ row, kind });
    if (toastId.current) toast.dismiss(toastId.current);
    if (document.visibilityState === "hidden") {
      controller.current!.finish(token, true);
      return;
    }
    const id = toast.success(
      kind === "done" ? "已标记为完成" : `已取消关注 ${row.label}`,
      {
        action: {
          label: "撤销",
          onClick: () => {
            controller.current!.finish(token, false);
            toast.dismiss(id);
          },
        },
        onClose: () => controller.current!.finish(token, true),
      },
    );
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
  return {
    hidden,
    done: (row: DiscoveryRow) => stage(row, "done"),
    unfollow: (row: DiscoveryRow) => stage(row, "unfollow"),
  };
}
