import assert from "node:assert/strict";
import test from "node:test";

import { createHumanApplicationPort } from "@rah-os/kernel";
import {
  MemoryListResponseSchema,
  MemoryPolicySchema,
  MemoryReadResponseSchema,
  WorkerMemoryMutationReceiptSchema,
} from "@rah-os/protocol";

import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import {
  ClientApplicationService,
  WorkerApplicationService,
} from "../src/index.ts";

// evo S6 batch A: the Worker CLI route and the Human API are facades over
// the same Kernel memory owner. Fake Host, temporary database.

async function harness() {
  const f = roleInstanceFixture();
  const worker = new WorkerApplicationService({ kernel: f.kernel });
  const client = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => ({
      apiVersion: 3,
      buildVersion: "test",
      capabilities: {} as never,
      kernelSchemaVersion: 74,
      protocolVersion: 1,
      state: "online",
    }),
  });
  await worker.start();
  await client.start();
  const work = startInstanceRun(f);
  const credential = worker.issueActivationCredential(f.host, work.scope);
  const workerPost = async (path: string, body: unknown) => {
    const response = await fetch(`${worker.origin}/v1/worker/memory/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  };
  const humanPost = async (
    path: string,
    body: unknown,
    token = f.owner.accessToken,
  ) => {
    const response = await fetch(`${client.origin}/v3/client/memory/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  };
  const sdk = new HttpRahClient({
    accessToken: () => f.owner.accessToken,
    baseUrl: client.origin,
  });
  const close = async () => {
    await worker.close();
    await client.close();
    f.close();
  };
  return { f, work, workerPost, humanPost, sdk, close };
}

const note = {
  name: "release-train",
  type: "project",
  description: "releases leave on Thursdays",
  body: "Release branches are cut on Thursday.\n**Why:** QA staffing.",
  idempotencyKey: "write-release-train",
};

test("the Worker memory route derives scope and provenance from the credential", async () => {
  const h = await harness();
  try {
    const forged = await h.workerPost("write", {
      ...note,
      actorPrincipalId: h.f.owner.principal.principalId,
    });
    assert.equal(forged.status, 400);
    const scoped = await h.workerPost("write", {
      ...note,
      channelId: h.f.channel("elsewhere").roomId,
    });
    assert.equal(scoped.status, 400);
    const written = await h.workerPost("write", note);
    assert.equal(written.status, 200);
    WorkerMemoryMutationReceiptSchema.parse(written.body);
    const stored = MemoryReadResponseSchema.parse(
      (await h.workerPost("read", { name: "release-train" })).body,
    );
    assert.equal(stored.entry.channelId, h.f.home.roomId);
    assert.equal(
      stored.entry.provenance.actorPrincipalId,
      h.f.instance.instanceId,
    );
    assert.equal(stored.entry.provenance.runAttemptId, h.work.run.runAttemptId);
    const list = MemoryListResponseSchema.parse(
      (await h.workerPost("list", {})).body,
    );
    assert.deepEqual(
      list.entries.map((entry) => entry.name),
      ["release-train"],
    );
    const read = MemoryReadResponseSchema.parse(
      (await h.workerPost("read", { name: "release-train" })).body,
    );
    assert.equal(read.entry.body, note.body);
    assert.equal(
      (await h.workerPost("search", { query: "Thursday" })).status,
      200,
    );
    assert.equal(
      (await h.workerPost("history", { name: "release-train" })).status,
      200,
    );
    const stale = await h.workerPost("update", {
      name: "release-train",
      expectedRevision: 9,
      body: "lost",
      idempotencyKey: "stale-update",
    });
    assert.equal(stale.status, 409);
    const invalidated = await h.workerPost("invalidate", {
      name: "release-train",
      expectedRevision: 1,
      reason: "moved to Fridays",
      idempotencyKey: "invalidate-release-train",
    });
    assert.equal(invalidated.status, 200);
    assert.equal(
      (
        await h.workerPost("restore", {
          name: "release-train",
          expectedRevision: 2,
          idempotencyKey: "restore-release-train",
        })
      ).status,
      200,
    );
    // Delete is Human-only: the Worker surface has no delete route.
    const deleted = await h.workerPost("delete", {
      name: "release-train",
      expectedRevision: 3,
      reason: "x",
      idempotencyKey: "worker-delete",
    });
    assert.equal(deleted.status, 404);
  } finally {
    await h.close();
  }
});

test("Human API and SDK administer memory and switches; the Worker route obeys them", async () => {
  const h = await harness();
  try {
    const written = WorkerMemoryMutationReceiptSchema.parse(
      (await h.workerPost("write", note)).body,
    );
    const entryId = written.entryId;
    const channelId = h.f.home.roomId;
    const agentToken = h.f.kernel.provisionPrincipal({
      handle: "memory-agent",
      kind: "agent",
    }).accessToken;
    assert.equal(
      (await h.humanPost("list", { channelId }, agentToken)).status,
      401,
    );
    const listed = await h.sdk.request("memory.list", { channelId });
    assert.deepEqual(
      listed.entries.map((entry) => entry.entryId),
      [entryId],
    );
    assert.equal(
      (await h.sdk.request("memory.read", { entryId })).entry.body,
      note.body,
    );
    assert.equal(
      (await h.sdk.request("memory.search", { channelId, query: "Thursday" }))
        .entries.length,
      1,
    );
    const pinned = await h.sdk.request("memory.pin", {
      entryId,
      expectedRevision: 1,
      pinned: true,
      idempotencyKey: "pin",
    });
    assert.equal(pinned.entry.pinned, true);
    await h.sdk.request("memory.invalidate", {
      entryId,
      expectedRevision: 2,
      reason: "stale",
      idempotencyKey: "invalidate",
    });
    await h.sdk.request("memory.restore", {
      entryId,
      expectedRevision: 3,
      idempotencyKey: "restore",
    });
    const policy = MemoryPolicySchema.parse(
      (await h.humanPost("policy/read", { channelId })).body,
    );
    assert.equal(policy.revision, 0);
    const updated = await h.sdk.request("memory.policy.update", {
      channelId,
      expectedRevision: 0,
      overrides: [
        { instanceId: h.f.instance.instanceId, read: true, write: false },
      ],
      idempotencyKey: "policy",
    });
    assert.deepEqual(updated.policy.members, [
      { instanceId: h.f.instance.instanceId, read: true, write: false },
    ]);
    const refused = await h.workerPost("write", {
      ...note,
      name: "another",
      idempotencyKey: "write-another",
    });
    assert.equal(refused.status, 403);
    assert.equal((await h.workerPost("list", {})).status, 200);
    await h.sdk.request("memory.policy.update", {
      channelId,
      expectedRevision: 1,
      readDefault: false,
      idempotencyKey: "policy-read-off",
    });
    assert.equal(
      (await h.sdk.request("memory.policy.read", { channelId })).readDefault,
      false,
    );
    assert.equal((await h.workerPost("list", {})).status, 200);
    await h.sdk.request("memory.policy.update", {
      channelId,
      expectedRevision: 2,
      overrides: [
        { instanceId: h.f.instance.instanceId, read: null, write: null },
      ],
      idempotencyKey: "policy-clear-override",
    });
    assert.equal(
      (await h.workerPost("list", {})).status,
      403,
      "without the override the channel default (read off) applies",
    );
    const deleted = await h.sdk.request("memory.delete", {
      entryId,
      expectedRevision: 4,
      reason: "privacy",
      idempotencyKey: "delete",
    });
    assert.equal(deleted.entry.state, "deleted");
    assert.equal(deleted.entry.body, null);
    const history = await h.sdk.request("memory.history", { entryId });
    assert.ok(history.revisions.every((revision) => revision.body === null));
  } finally {
    await h.close();
  }
});

test("with read off and write on, Worker mutations and their replays return only a receipt", async () => {
  const h = await harness();
  try {
    const secret = "REVIEW-SECRET-BODY";
    const secretDescription = "REVIEW-SECRET-DESCRIPTION";
    const writeRequest = {
      ...note,
      description: secretDescription,
      body: secret,
    };
    const written = await h.workerPost("write", writeRequest);
    assert.equal(written.status, 200);
    const channelId = h.f.home.roomId;
    await h.sdk.request("memory.policy.update", {
      channelId,
      expectedRevision: 0,
      readDefault: false,
      writeDefault: true,
      idempotencyKey: "policy-write-only",
    });
    assert.equal((await h.workerPost("read", { name: note.name })).status, 403);
    const noLeak = (
      label: string,
      response: { status: number; body: unknown },
    ) => {
      const serialized = JSON.stringify(response.body);
      assert.doesNotMatch(
        serialized,
        /REVIEW-SECRET-BODY|REVIEW-SECRET-DESCRIPTION/u,
        `${label} leaks memory content`,
      );
      assert.doesNotMatch(serialized, /provenance|"body"|"description"/u);
    };
    const receiptKeys = [
      "deduplicated",
      "entryId",
      "name",
      "op",
      "revision",
      "state",
    ];
    const replayedWrite = await h.workerPost("write", writeRequest);
    assert.equal(replayedWrite.status, 200);
    noLeak("write replay", replayedWrite);
    assert.deepEqual(
      Object.keys(replayedWrite.body as object).sort(),
      receiptKeys,
    );
    const updateRequest = {
      name: note.name,
      expectedRevision: 1,
      type: "reference",
      idempotencyKey: "update-type-only",
    };
    const updated = await h.workerPost("update", updateRequest);
    assert.equal(updated.status, 200);
    noLeak("update", updated);
    const receipt = WorkerMemoryMutationReceiptSchema.parse(updated.body);
    assert.deepEqual(Object.keys(receipt).sort(), receiptKeys);
    assert.deepEqual(
      { ...receipt, entryId: "x" },
      {
        entryId: "x",
        name: note.name,
        revision: 2,
        op: "update",
        state: "active",
        deduplicated: false,
      },
    );
    const replayedUpdate = await h.workerPost("update", updateRequest);
    noLeak("update replay", replayedUpdate);
    assert.equal(
      WorkerMemoryMutationReceiptSchema.parse(replayedUpdate.body).deduplicated,
      true,
    );
    const invalidateRequest = {
      name: note.name,
      expectedRevision: 2,
      reason: "superseded",
      idempotencyKey: "invalidate-write-only",
    };
    const invalidated = await h.workerPost("invalidate", invalidateRequest);
    assert.equal(invalidated.status, 200);
    noLeak("invalidate", invalidated);
    noLeak(
      "invalidate replay",
      await h.workerPost("invalidate", invalidateRequest),
    );
    const restoreRequest = {
      name: note.name,
      expectedRevision: 3,
      idempotencyKey: "restore-write-only",
    };
    const restored = await h.workerPost("restore", restoreRequest);
    assert.equal(restored.status, 200);
    noLeak("restore", restored);
    assert.equal(
      WorkerMemoryMutationReceiptSchema.parse(restored.body).state,
      "active",
    );
    noLeak("restore replay", await h.workerPost("restore", restoreRequest));
    // Conflicts may name the current revision, never the content.
    const stale = await h.workerPost("update", {
      name: note.name,
      expectedRevision: 1,
      body: "lost",
      idempotencyKey: "update-stale-write-only",
    });
    assert.equal(stale.status, 409);
    noLeak("revision conflict", stale);
    const duplicate = await h.workerPost("write", {
      ...writeRequest,
      idempotencyKey: "write-duplicate-name",
    });
    assert.equal(duplicate.status, 409);
    noLeak("name conflict", duplicate);
    // Without read, an unchanged update is not an equality oracle.
    const sameBody = await h.workerPost("update", {
      name: note.name,
      expectedRevision: 4,
      body: secret,
      idempotencyKey: "update-same-body",
    });
    assert.equal(sameBody.status, 200);
    noLeak("unchanged update", sameBody);
    // The Human API still returns the full entry.
    const human = await h.sdk.request("memory.read", {
      entryId: receipt.entryId,
    });
    assert.equal(human.entry.body, secret);
  } finally {
    await h.close();
  }
});
