import { useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { SystemNotification } from "@rah-os/protocol";
import { opaqueIdFromBytes } from "@rah-os/ui-web";

// Optimistic presentation follows a successful canonical dismissal. Durable
// preference ownership lives behind notification.dismiss, never localStorage.
export function useSystemNotices(
  notices: readonly SystemNotification[],
  client: RahClient,
  workspaceId?: string,
) {
  const key = workspaceId ?? "none";
  const [state, setState] = useState<{ key: string; ids: string[] }>();
  const ids = state?.key === key ? state.ids : [];
  return {
    notices: notices.filter((notice) => !ids.includes(notice.notificationId)),
    async dismiss(notificationId: string) {
      if (
        workspaceId === undefined ||
        !notices.some(
          (notice) =>
            notice.notificationId === notificationId && notice.dismissible,
        )
      )
        return;
      await client.request("notification.dismiss", {
        idempotencyKey: `web-notification-dismiss-${opaqueIdFromBytes(globalThis.crypto.getRandomValues(new Uint8Array(16)))}`,
        notificationId,
        workspaceId,
      });
      const id = notificationId;
      const next = [...new Set([...ids, id])].slice(-100);
      setState({ key, ids: next });
    },
  };
}
