import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import {
  GenericProcessAdapter,
  RemoteRuntimeProfileSet,
  RuntimeCredentialEnvironmentBinding,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  type RemoteWorkerCredentialServicePort,
} from "../src/index.ts";

function manifest(): RuntimeProfileManifestV2 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable: process.execPath,
      fixedArgs: [
        "-e",
        "const inbox=JSON.parse(require('node:child_process').execFileSync(process.env.RAH_AGENT_INBOX_CLI,['agent','inbox','recheck'],{encoding:'utf8'}));if(inbox.measurement!=='under_threshold')throw new Error('Remote Computer-local inbox recheck failed');" +
          "const fs=require('node:fs');const token=fs.readFileSync(process.env.RAH_WORKER_SESSION_FILE,'utf8');const memory=fs.readFileSync(process.env.RAH_AGENT_MEMORY_INDEX,'utf8');process.stdout.write(`${process.env.PROVIDER_TOKEN}|${process.env.RAH_WORKER_TOKEN===undefined}|${token.length>0}|${process.env.RAH_WORKER_API_URL}|${memory.includes('# Remote Agent')}|${process.env.RAH_AGENT_MEMORY_INDEX.endsWith('/MEMORY.md')}|${JSON.parse(process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON).mode==='raft_original' && JSON.parse(process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON).status==='read_original' && JSON.parse(process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON).text==='' && Buffer.byteLength(process.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON)<=4096}|${JSON.parse(fs.readFileSync(process.env.RAH_AGENT_MEMORY_SOURCE_FILE,'utf8')).source.realCwd===fs.realpathSync(process.cwd())}`);process.stdout.write('\\n')",
      ],
      kind: "generic-process/v1",
    },
    credentialSlots: [
      {
        slotId: "provider-token",
        target: { kind: "environment", variable: "PROVIDER_TOKEN" },
      },
    ],
    declaredCapabilities: ["worker_commands"],
    displayName: "Remote profile fixture",
    manifestVersion: 2,
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "remote-profile-fixture",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

test("remote configured Runtime combines profile secrets with one activation-scoped Worker lease", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-remote-runtime-"));
  chmodSync(directory, 0o700);
  const registry = new RuntimeProfileRegistry({
    databasePath: join(directory, "runtime-registry.db"),
    hostId: "host-remote-profile",
  });
  try {
    registry.initialize();
    const imported = registry.importManifest(manifest());
    const implementations = new RuntimeImplementationRegistry();
    const report = registry.recordProbeReport(
      await implementations.probeRevision(imported, { cwd: directory }),
    );
    const active = registry.activateRevision({
      contentDigest: imported.contentDigest,
      runtimeProfileRevisionId: imported.runtimeProfileRevisionId,
    });
    let issued = 0;
    let revoked = 0;
    const worker: RemoteWorkerCredentialServicePort = {
      issueWorkerCredential: async (request) => {
        issued += 1;
        assert.equal(request.activationId, "activation-remote-profile");
        return {
          credentialId: "worker-credential-1",
          expiresAt: "2026-08-28T00:01:00.000Z",
          workerAccessToken: "worker-secret-value",
          workerApiOrigin: "https://worker.example.test",
        };
      },
      revokeWorkerCredential: async (request) => {
        assert.equal(request.credentialId, "worker-credential-1");
        revoked += 1;
        return { revoked: true };
      },
    };
    const profiles = new RemoteRuntimeProfileSet({
      implementations,
      supervisorDirectory: join(directory, "supervisors"),
      profiles: [
        {
          credentialEnvironment: new RuntimeCredentialEnvironmentBinding({
            manifest: active.manifest,
            resolvers: {
              // Keep a suffix-prefix collision deterministic: an unterminated
              // trailing "true" must not be used as a transport assertion.
              "provider-token": async () => "e-provider-secret-value",
            },
          }),
          cwd: directory,
          leaseMs: 60_000,
          maxConcurrent: 1,
          probeReport: report,
          runtimeOfferId: "offer-remote-profile",
          runtimeProfileRegistry: registry,
          runtimeProfileRevision: active,
          workspaceMountDescriptors: [],
        },
      ],
    });
    assert.deepEqual(
      profiles
        .runtimeOffers({
          hostId: "host-remote-profile",
          hostInstanceId: "instance-remote-profile",
        })
        .map((offer) => ({
          hostId: offer.hostId,
          runtimeOfferId: offer.runtimeOfferId,
          state: offer.state,
        })),
      [
        {
          hostId: "host-remote-profile",
          runtimeOfferId: "offer-remote-profile",
          state: "available",
        },
      ],
    );
    const binding = profiles.createRuntimeBinding(worker);
    const runtime = binding.runtime;
    const run = await runtime.start(
      {
        activationId: "activation-remote-profile",
        consumerId: "consumer-remote-profile",
        fromSeq: 1,
        hostId: "host-remote-profile",
        participantId: "agent-remote-profile",
        reason: "manual",
        roomId: "room-remote-profile",
        runAttemptId: "run-attempt-remote-profile",
        toSeq: 1,
        agent: {
          agentDefinitionRevision: {
            agentId: "agent-definition-remote-profile",
            agentDefinitionRevisionId: "agent-revision-remote-profile-v1",
            contentDigest: `sha256:${"1".repeat(64)}`,
            createdAt: "2026-08-29T12:00:00.000+08:00",
            createdBy: "human-owner",
            displayName: "Remote Agent",
            executionPolicyRevisionId: "execution-full-access-v1",
            instructionRefs: [],
            memoryPolicyRef: {
              artifactId: "memory-policy",
              contentDigest: `sha256:${"2".repeat(64)}`,
              versionId: "memory-policy-v1",
            },
            revision: 1,
            role: "Remote persistent Agent",
            skillRefs: [],
          },
          handle: "remote-agent",
          participantId: "agent-remote-profile",
          schemaVersion: 1,
        },
      },
      { registerPrepared: async () => undefined },
    );
    assert.equal((await runtime.reap(run)).code, 0);
    assert.equal(issued, 1);
    assert.equal(revoked, 1);
    assert.ok(runtime instanceof GenericProcessAdapter);
    const diagnostics = runtime.diagnostics(run).stdout;
    assert.ok(!diagnostics.includes("provider-secret-value"));
    assert.ok(!diagnostics.includes("worker-secret-value"));
    assert.match(diagnostics, /\[REDACTED\]\|true\|true\|/u);
    assert.match(diagnostics, /worker\.example\.test/u);
    assert.match(
      diagnostics,
      /worker\.example\.test\|true\|true\|true\|true\n$/u,
    );

    const replacement = registry.importManifest({
      ...manifest(),
      displayName: "Remote profile replacement",
    });
    registry.recordProbeReport(
      await implementations.probeRevision(replacement, { cwd: directory }),
    );
    registry.activateRevision({
      contentDigest: replacement.contentDigest,
      runtimeProfileRevisionId: replacement.runtimeProfileRevisionId,
    });
    assert.equal(
      profiles.runtimeOffers({
        hostId: "host-remote-profile",
        hostInstanceId: "instance-remote-profile",
      })[0]?.state,
      "unavailable",
    );
    await assert.rejects(
      runtime.start(
        {
          activationId: "activation-stale-profile",
          consumerId: "consumer-remote-profile",
          fromSeq: 2,
          hostId: "host-remote-profile",
          participantId: "agent-remote-profile",
          reason: "manual",
          roomId: "room-remote-profile",
          runAttemptId: "run-attempt-stale-profile",
          toSeq: 2,
        },
        { registerPrepared: async () => undefined },
      ),
      /active revision changed/u,
    );
    assert.equal(issued, 1, "stale profile is fenced before credential issue");
  } finally {
    registry.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
