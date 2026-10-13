import { currentRuntimeOfferFromRow } from "../../kernel/src/runtime-offer-tool-access.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProviderSessionStore,
  type RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import {
  createDaemonInstanceFork,
  createDaemonSide,
} from "../src/daemon-instance-fork.ts";
import {
  roleInstanceFixture,
  claimInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";
import type { ConfiguredLocalRuntimeSnapshot } from "../src/local-runtime-inventory.ts";

for (const provider of ["opencode-server/v1", "codex-app-server/v1"])
  for (const mode of ["fork", "side"])
    test(`Daemon ${provider} ${mode} binds independent context through the shared pipeline without copying twice`, async () => {
      const f = roleInstanceFixture();
      const root = await mkdtemp(join(tmpdir(), "loom-daemon-fork-"));
      try {
        // Fixture setup: this fake runtime shares a channel cwd. No paid CLI is launched.
        f.kernel.postMessage(f.actor, {
          roomId: f.home.roomId,
          body: "fixture source",
          idempotencyKey: "source-turn",
          recipients: [
            { participantId: f.instance.instanceId, reason: "mention" },
          ],
        });
        const run = claimInstanceRun(f);
        f.kernel.instanceSessions.record(f.host, {
          runAttemptId: run.run.runAttemptId,
          runtimeRunId: run.runtime.runtimeRunId,
        });
        run.finish(0);
        f.db
          .prepare(
            "UPDATE agent_definition_revisions SET definition_json=json_set(definition_json,'$.executionWorkspace',json(?)) WHERE agent_definition_revision_id=?",
          )
          .run(
            JSON.stringify({ kind: "channel_home", roomId: f.home.roomId }),
            f.revisionId,
          );
        const offer = currentRuntimeOfferFromRow(
          f.db
            .prepare(
              "SELECT * FROM runtime_offers WHERE runtime_offer_id='offer'",
            )
            .get()!,
        );
        const {
          acceptedAt,
          resolvedCertifications,
          runtimeOfferObservationId,
          runtimeOfferSnapshotDigest,
          ...report
        } = offer;
        f.kernel.publishRuntimeOffer(f.host, {
          ...report,
          supportsAgentPrivateWorkspace: true,
          observedAt: new Date().toISOString(),
        });

        const store = new ProviderSessionStore({
          rootDirectory: join(root, "supervisors", "provider-sessions"),
        });
        const key = {
          participantId: f.instance.instanceId,
          provider,
          runtimeProfileRevisionId: "profile-v1",
          workspaceMountRevisionId: "mount",
        };
        await store.record(key, "native-source", { instance: true });
        let copies = 0;
        const registry = {
          listProfiles: () => [
            { runtimeProfileId: "profile", activeRevisionId: "profile-v1" },
          ],
          getActiveRevision: () => ({
            runtimeProfileRevisionId: "profile-v1",
            manifest: {
              manifestVersion: 2,
              adapter: { kind: provider },
              credentialSlots: [],
              staticEnv: { FIXTURE_SETTING: "frozen" },
            },
          }),
        } as unknown as RuntimeProfileRegistry;
        const configured = [
          {
            runtimeProfileRevisionId: "profile-v1",
            available: true,
            cliId: provider === "opencode-server/v1" ? "opencode" : "codex",
            executable: "fixture-opencode",
          },
        ] as ConfiguredLocalRuntimeSnapshot[];
        const fork = (
          mode === "fork" ? createDaemonInstanceFork : createDaemonSide
        )({
          kernel: f.kernel,
          host: f.host,
          stateDirectory: root,
          registries: new Map([["fixture", registry]]),
          configured,
          memory: {
            workspaceRoots: async () => ({
              defaultRootId: "runtime-project",
              roots: [
                {
                  rootId: "runtime-project",
                  rootKind: "runtime-project",
                  label: "FIXTURE",
                  rootPath: root,
                  state: "ready",
                },
              ],
            }),
          },
          copyNative: async (args) => {
            copies++;
            assert.equal(args.sourceId, "native-source");
            assert.equal(args.cwd, root);
            assert.equal(args.env.FIXTURE_SETTING, "frozen");
            assert.equal(
              f.db.prepare("SELECT count(*) AS n FROM role_instances").get()?.n,
              1,
            );
            return "native-child";
          },
        });
        const request = {
          instanceId: f.instance.instanceId,
          basedOnRoomSeq: f.head(f.home.roomId),
          idempotencyKey: "fork",
        };
        const result = await fork(f.actor, request);
        assert.equal(
          (
            await store.load(
              {
                ...key,
                participantId:
                  "instance" in result
                    ? result.instance.instanceId
                    : result.side.instanceId,
              },
              { instance: true, requireExisting: true },
            )
          )?.providerSessionId,
          "native-child",
        );
        assert.equal((await fork(f.actor, request)).deduplicated, true);
        assert.equal(copies, 1);
        assert.equal(
          (await store.load(key, { instance: true }))?.providerSessionId,
          "native-source",
        );
      } finally {
        f.close();
        await rm(root, { recursive: true, force: true });
      }
    });
