import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dismissSystemNotification } from "../../frontends/raft/loom/system-notifications.ts";
import { adaptNotificationTrigger } from "../../frontends/raft/loom/notification-adaptation.ts";
test("controlled notification trigger preserves native markup and does not run cloud notification collectors", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/layout/NotificationTrigger.tsx",
    "utf8",
  );
  const next = adaptNotificationTrigger(source);
  assert.equal(
    next.slice(next.indexOf("  return (")),
    source.slice(source.indexOf("  return (")),
  );
  assert.ok(
    !next.includes("const liveNotifications = useVisibleNotifications("),
  );
  assert.throws(() => adaptNotificationTrigger("drift"));
});
test("dismiss carries existing authenticated workspace contract and lost result is not resent", async () => {
  const calls: any[] = [];
  const client: any = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      throw Error("lost");
    },
  };
  await assert.rejects(
    dismissSystemNotification(client, "workspace", "notice", "key"),
  );
  assert.deepEqual(calls, [
    [
      "notification.dismiss",
      {
        workspaceId: "workspace",
        notificationId: "notice",
        idempotencyKey: "key",
      },
    ],
  ]);
});
