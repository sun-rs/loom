import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  localNotificationKey,
  localNotificationsEnabled,
  showLocalNotification,
  supportsLocalNotifications,
} from "./local-notifications.ts";
/** One online reader per browser/workspace; durable Room events remain the source. */
export default function LocalNotifications({
  client,
  workspaceId,
}: {
  client: RahClient;
  workspaceId: string;
}) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener("storage", changed);
    window.addEventListener("loom-local-notifications", changed);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("loom-local-notifications", changed);
    };
  }, []);
  useEffect(() => {
    if (
      !supportsLocalNotifications() ||
      Notification.permission !== "granted" ||
      !localNotificationsEnabled(workspaceId)
    )
      return;
    const stop = new AbortController();
    const run = async () => {
      let cursor: number | undefined;
      const cursorKey = localNotificationKey(workspaceId) + ":cursor";
      const saved = localStorage.getItem(cursorKey);
      if (
        saved !== null &&
        Number.isSafeInteger(Number(saved)) &&
        Number(saved) >= 0
      )
        cursor = Number(saved);
      while (!stop.signal.aborted) {
        let delay = 5000;
        try {
          const response = await client.request(
            "notification.local",
            { workspaceId, ...(cursor === undefined ? {} : { after: cursor }) },
            {
              signal: AbortSignal.any([
                stop.signal,
                AbortSignal.timeout(10000),
              ]),
            },
          );
          if (stop.signal.aborted) return;
          for (const notification of response.notifications) {
            if (stop.signal.aborted || !localNotificationsEnabled(workspaceId))
              return;
            await showLocalNotification(notification);
          }
          cursor = response.cursor;
          localStorage.setItem(cursorKey, String(cursor));
          if (response.hasMore) delay = 100;
        } catch {
          /* Retain cursor; bounded replay and worker receipts recover transient failures. */
        }
        if (stop.signal.aborted) return;
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            stop.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, delay);
          stop.signal.addEventListener("abort", done, { once: true });
        });
      }
    };
    if (navigator.locks)
      void navigator.locks
        .request(
          `loom-notifications:${workspaceId}`,
          { signal: stop.signal },
          run,
        )
        .catch(() => {});
    else void run(); // Shared worker still deduplicates presentation.
    return () => stop.abort();
  }, [client, workspaceId, revision]);
  return null;
}
