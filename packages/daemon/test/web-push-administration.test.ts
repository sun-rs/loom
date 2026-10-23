import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/core";
import { createWebPushAdministration } from "../src/web-push-administration.ts";
import { WebPushStateStore } from "../src/web-push-state.ts";

test("Web Push administration scopes devices to the authenticated Human", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-web-push-admin-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const actor = kernel.authenticateHumanAccessToken(human.accessToken);
    const sent: string[] = [];
    const tags: string[] = [];
    const state = new WebPushStateStore({ directory: join(directory, "push") });
    const administration = createWebPushAdministration({
      hostId: "host-local",
      state,
      transport: {
        async send(subscription, payload) {
          tags.push(payload.tag);
          sent.push(`${subscription.endpoint}:${payload.target.kind}`);
        },
      },
    });
    assert.equal(
      (await administration.configuration(actor)).subscriptionCount,
      0,
    );
    await administration.subscribe(actor, {
      subscription: {
        endpoint: "https://push.example/device",
        keys: { auth: "auth_key", p256dh: "public_key" },
      },
    });
    assert.equal(
      (await administration.configuration(actor)).subscriptionCount,
      1,
    );
    assert.equal(
      (
        await administration.configuration(actor, {
          endpoint: "https://push.example/device",
        })
      ).subscribed,
      true,
    );
    assert.equal(
      (
        await administration.configuration(actor, {
          endpoint: "https://push.example/other",
        })
      ).subscribed,
      false,
    );
    const other = kernel.provisionPrincipal({ handle: "other", kind: "human" });
    assert.equal(
      (
        await administration.configuration(
          kernel.authenticateHumanAccessToken(other.accessToken),
          { endpoint: "https://push.example/device" },
        )
      ).subscribed,
      false,
    );
    assert.deepEqual(await administration.test(actor, {}), { delivered: 1 });
    assert.deepEqual(sent, ["https://push.example/device:computer"]);
    await administration.test(actor, {});
    const warnings: unknown[][] = [];
    t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
    const failed = createWebPushAdministration({
      hostId: "host-local",
      state,
      transport: {
        async send() {
          throw Object.assign(new Error("secret endpoint"), {
            code: "ECONNRESET",
          });
        },
      },
    });
    await assert.rejects(failed.test(actor, {}), /secret endpoint/);
    assert.match(JSON.stringify(warnings), /ECONNRESET/);
    assert.doesNotMatch(JSON.stringify(warnings), /secret|push.example/);
    assert.notEqual(
      tags[0],
      tags[1],
      "explicit tests must not replace the previous notification",
    );
  } finally {
    kernel.close();
    await rm(directory, { recursive: true, force: true });
  }
});
