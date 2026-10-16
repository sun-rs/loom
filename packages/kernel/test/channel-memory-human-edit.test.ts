import test from "node:test";
import assert from "node:assert/strict";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "./role-instance-fixture.ts";
test("Human edit creates an authenticated revision, rejects stale edits and preserves exact replay", () => {
  const f = roleInstanceFixture();
  try {
    const work = startInstanceRun(f);
    const written = f.kernel.memory.write(work.execution, {
      name: "human-edit",
      type: "project",
      description: "before",
      body: "old body",
      idempotencyKey: "seed",
    });
    work.finish(0);
    const input = {
      entryId: written.entryId,
      expectedRevision: 1,
      description: "after",
      body: "new body",
      idempotencyKey: "human-edit",
    };
    const outsider = f.kernel.provisionPrincipal({
      handle: "memory-outsider",
      kind: "human",
    });
    assert.throws(
      () =>
        f.kernel.memory.humanUpdate(
          f.kernel.authenticateAccessToken(outsider.accessToken),
          input,
        ),
      (error: Error & { code?: string }) => error.code === "forbidden",
    );
    const edited = f.kernel.memory.humanUpdate(f.actor, input);
    assert.equal(edited.entry.revision, 2);
    assert.equal(edited.entry.body, "new body");
    assert.equal(edited.entry.provenance.actorKind, "human");
    assert.equal(
      edited.entry.provenance.actorPrincipalId,
      f.owner.principal.principalId,
    );
    assert.equal(
      f.kernel.memory.humanUpdate(f.actor, input).deduplicated,
      true,
    );
    assert.throws(
      () =>
        f.kernel.memory.humanUpdate(f.actor, {
          ...input,
          idempotencyKey: "stale",
        }),
      /revision/,
    );
    assert.throws(
      () =>
        f.kernel.memory.humanUpdate(f.actor, {
          ...input,
          expectedRevision: 2,
          idempotencyKey: "forge",
          actorPrincipalId: "other",
        } as never),
      /Unrecognized/,
    );
    f.kernel.memory.humanInvalidate(f.actor, {
      entryId: written.entryId,
      expectedRevision: 2,
      reason: "obsolete",
      idempotencyKey: "invalidate",
    });
    assert.throws(
      () =>
        f.kernel.memory.humanUpdate(f.actor, {
          ...input,
          expectedRevision: 3,
          idempotencyKey: "invalidated",
        }),
      /restore/,
    );
    assert.equal(
      f.kernel.memory
        .humanHistory(f.actor, { entryId: written.entryId })
        .revisions.find((r) => r.revision === 1)?.body,
      "old body",
    );
  } finally {
    f.close();
  }
});
