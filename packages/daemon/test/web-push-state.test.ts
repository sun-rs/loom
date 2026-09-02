import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WebPushStateStore } from "../src/web-push-state.ts";

test("Web Push state persists stable VAPID keys and principal-scoped subscriptions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-web-push-"));
  try {
    const store = new WebPushStateStore({ directory });
    const firstKeys = await store.vapidKeys();
    await store.put("human-a", {
      endpoint: "https://push.example/a",
      keys: { auth: "auth_a", p256dh: "public_a" },
    });
    await store.put("human-a", {
      endpoint: "https://push.example/a",
      keys: { auth: "auth_b", p256dh: "public_b" },
    });
    await store.put("human-b", {
      endpoint: "https://push.example/b",
      keys: { auth: "auth_c", p256dh: "public_c" },
    });
    assert.equal((await store.list("human-a")).length, 1);
    assert.equal((await store.list("human-a"))[0]?.keys.auth, "auth_b");
    assert.equal(
      (await new WebPushStateStore({ directory }).vapidKeys()).publicKey,
      firstKeys.publicKey,
    );
    assert.equal(
      (await stat(join(directory, "web-push.json"))).mode & 0o777,
      0o600,
    );
    assert.equal(await store.remove("human-a", "https://push.example/a"), true);
    assert.equal((await store.list("human-a")).length, 0);
    assert.equal((await store.list("human-b")).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
