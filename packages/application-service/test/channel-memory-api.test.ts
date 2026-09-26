import assert from "node:assert/strict";
import test from "node:test";

import { createHumanApplicationPort } from "@rah-os/kernel";
import {
  MemoryListResponseSchema,
  MemoryPolicySchema,
  MemoryReadResponseSchema,
  WorkerMemoryMutationReceiptSchema,
  WorkerMessagePresentResponseSchema,
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

async function harness(
  options: {
    agentMemoryAdministration?: NonNullable<
      ConstructorParameters<
        typeof ClientApplicationService
      >[0]["agentMemoryAdministration"]
    >;
  } = {},
) {
  const f = roleInstanceFixture();
  const worker = new WorkerApplicationService({ kernel: f.kernel });
  const client = new ClientApplicationService({
    ...(options.agentMemoryAdministration === undefined
      ? {}
      : { agentMemoryAdministration: options.agentMemoryAdministration }),
    human: createHumanApplicationPort(f.kernel),
    health: () => ({
      apiVersion: 3,
      buildVersion: "test",
      capabilities: {} as never,
      kernelSchemaVersion: 75,
      protocolVersion: 1,
      state: "online",
    }),
  });
  await worker.start();
  await client.start();
  const work = startInstanceRun(f);
  const credential = worker.issueActivationCredential(f.host, work.scope);
  const workerPost = async (path: string, body: unknown) => {
    const response = await fetch(
      `${worker.origin}/v1/worker/${path.startsWith("/") ? path.slice(1) : `memory/${path}`}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
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

test("a Human imports an instance's legacy memory through the API and SDK, once", async () => {
  const legacy: Record<string, string> = {
    "MEMORY.md": "# Memory\n- [deploy](notes/deploy.md)\n",
    "notes/deploy.md": "# Deploy\nrun make release\n",
  };
  const reads: string[] = [];
  const file = (relativePath: string) => ({
    bytes: Buffer.byteLength(legacy[relativePath]!),
    contentDigest: `sha256:${"b".repeat(64)}`,
    modifiedAt: "2026-09-20T00:00:00.000Z",
    relativePath,
  });
  let owner = "";
  const h = await harness({
    agentMemoryAdministration: {
      computerHostId: "host",
      inspectWorkspace: (participantId: string) => {
        owner = participantId;
        return {
          files: Object.keys(legacy).map(file),
          indexOverThreshold: false,
          noteCount: 1,
          ownerParticipantId: participantId,
          schemaVersion: 1,
          state: "ready",
          thresholdBytes: 65536,
        } as const;
      },
      readWorkspaceFile: (participantId: string, relativePath: string) => {
        reads.push(relativePath);
        return {
          content: legacy[relativePath]!,
          file: file(relativePath),
          ownerParticipantId: participantId,
        };
      },
      resetWorkspace: () => {
        throw new Error("reset must not be called by an import");
      },
    } as never,
  });
  try {
    const channelId = h.f.home.roomId;
    const request = {
      channelId,
      instanceId: h.f.instance.instanceId,
      mode: "files" as const,
      idempotencyKey: "import-legacy",
    };
    const first = await h.sdk.request("memory.import.legacy", request);
    assert.equal(owner, h.f.instance.instanceId);
    assert.deepEqual(reads, ["MEMORY.md", "notes/deploy.md"]);
    assert.deepEqual(
      first.results.map((item) => [item.path, item.status]),
      [
        ["MEMORY.md", "created"],
        ["notes/deploy.md", "created"],
      ],
    );
    const again = await h.sdk.request("memory.import.legacy", {
      ...request,
      idempotencyKey: "import-legacy-2",
    });
    assert.deepEqual(
      again.results.map((item) => item.status),
      ["existing", "existing"],
    );
    const deploy = first.results.find(
      (item) => item.path === "notes/deploy.md",
    )!;
    const read = await h.sdk.request("memory.read", {
      entryId: deploy.entryId!,
    });
    assert.deepEqual(read.entry.provenance.importedFrom, {
      instanceId: h.f.instance.instanceId,
      path: "notes/deploy.md",
    });
    assert.equal(read.entry.provenance.actorKind, "human");
    const stranger = h.f.kernel.provisionPrincipal({
      handle: "stranger",
      kind: "human",
    });
    const refused = await h.humanPost(
      "import-legacy",
      request,
      stranger.accessToken,
    );
    assert.ok([403, 404].includes(refused.status));
  } finally {
    await h.close();
  }
});

test("legacy import is unavailable without the Host memory administration", async () => {
  const h = await harness();
  try {
    const response = await h.humanPost("import-legacy", {
      channelId: h.f.home.roomId,
      instanceId: h.f.instance.instanceId,
      mode: "whole",
      idempotencyKey: "import-unavailable",
    });
    assert.equal(response.status, 503);
  } finally {
    await h.close();
  }
});

test("message-present carries the memory delta since the Host's index seq", async () => {
  const h = await harness();
  try {
    assert.equal((await h.workerPost("write", note)).status, 200);
    const all = await h.workerPost("/message-present", {});
    assert.equal(all.status, 200);
    const delta = WorkerMessagePresentResponseSchema.parse(
      all.body,
    ).memoryDelta;
    assert.deepEqual(
      delta?.changes.map((item) => [item.name, item.description]),
      [["release-train", "releases leave on Thursdays"]],
    );
    const none = await h.workerPost("/message-present", {
      memoryIndexSeq: delta!.throughSeq,
    });
    assert.equal(
      WorkerMessagePresentResponseSchema.parse(none.body).memoryDelta,
      undefined,
    );
    assert.equal(
      (await h.workerPost("/message-present", { memoryIndexSeq: -1 })).status,
      400,
    );
  } finally {
    await h.close();
  }
});
