import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProviderSessionStore } from "../src/provider-session-store.ts";
import { SessionProtocolUpgrade } from "../src/session-protocol-upgrade.ts";
import type { ActivationEnvelope } from "../src/runtime.ts";

for (const provider of [
  "claude-stream-json/v1",
  "codex-app-server/v1",
  "opencode-server/v1",
  "kimi-acp/v1",
  "pi-print-json/v1",
])
  test(`Fork identity notice is delivered until accepted, then survives reload without repeating (${provider})`, async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-fork-identity-"));
    try {
      const store = new ProviderSessionStore({ rootDirectory: root });
      const source = {
        participantId: "tom-1-id",
        provider,
        runtimeProfileRevisionId: "profile",
        workspaceMountRevisionId: "mount",
      };
      const target = { ...source, participantId: "tom-2-id" };
      await store.record(source, "native-parent", {
        instance: true,
        standingProtocolVersion: "current",
      });
      const original = await store.load(source, { instance: true });
      await store.forkInstance(
        { source, target, sourceGeneration: 0, operationId: "fork-identity" },
        async () => "native-child",
      );
      const scope = {
        participantId: target.participantId,
        runAttemptId: "run-first",
        agent: {
          instanceChannelId: "channel",
          instanceSessionGeneration: 0,
          handle: "Tom-2",
          participantId: target.participantId,
          agentDefinitionRevision: { displayName: "Tom-2" },
        },
      } as ActivationEnvelope;
      const lease = { standingProtocolVersion: "current", env: {} };
      const upgrade = new SessionProtocolUpgrade(store);
      const first = upgrade.prepare(
        scope,
        lease,
        target,
        await store.load(target, { instance: true }),
      );
      assert.match(first!, /Fork identity/);
      assert.match(first!, /Tom-2/);
      assert.match(first!, /tom-2-id/);
      assert.match(first!, /tom-1-id/);
      assert.match(first!, /historical.*source instance/i);
      assert.match(first!, /current request/i);
      assert.equal(upgrade.noticeFor(scope), first);
      const besideRulesCard = upgrade.noticeFor(scope, { rulesCard: true });
      assert.match(besideRulesCard!, /Fork identity/);
      assert.doesNotMatch(besideRulesCard!, /Protocol updated/);
      await upgrade.accept({
        participantId: target.participantId,
        runAttemptId: "unrelated-run",
      });
      // Ordinary runtime rebinding must not erase the pending copy provenance.
      await store.record(target, "native-child", {
        instance: true,
        standingProtocolVersion: "current",
      });
      const recovered = new SessionProtocolUpgrade(
        new ProviderSessionStore({ rootDirectory: root }),
      );
      const second = { ...scope, runAttemptId: "run-retry" };
      assert.equal(
        recovered.prepare(
          second,
          lease,
          target,
          await store.load(target, { instance: true }),
        ),
        first,
      );
      await recovered.accept({
        participantId: target.participantId,
        runAttemptId: "run-retry",
      });
      assert.equal(recovered.noticeFor(second), undefined);
      const again = new SessionProtocolUpgrade(store);
      assert.equal(
        again.prepare(
          second,
          lease,
          target,
          await store.load(target, { instance: true }),
        ),
        undefined,
      );
      // Later protocol upgrades must not reannounce the branch identity.
      assert.doesNotMatch(
        again.prepare(
          second,
          { ...lease, standingProtocolVersion: "next" },
          target,
          await store.load(target, { instance: true }),
        )!,
        /Fork identity/,
      );
      assert.deepEqual(await store.load(source, { instance: true }), original);
      const fresh = { ...target, participantId: "fresh-instance" };
      await store.record(fresh, "fresh-session", { instance: true });
      assert.doesNotMatch(
        again.prepare(
          { ...scope, participantId: fresh.participantId },
          lease,
          fresh,
          await store.load(fresh, { instance: true }),
        )!,
        /Fork identity/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
