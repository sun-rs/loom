import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RuntimeProfileRevision } from "@rah-os/protocol";
import { createDaemonWorkerProfileMetadata } from "../src/daemon-worker-profile-metadata.ts";
import { LocalComputerProfileStore } from "../src/local-computer-profile-store.ts";
import { buildLocalRuntimeInventoryResponse } from "../src/local-runtime-inventory.ts";

test("Worker metadata and Human inventory share the edited Computer owner and heartbeat observation", () => {
  const root = mkdtempSync(join(tmpdir(), "rah-worker-metadata-"));
  try {
    const profiles = new LocalComputerProfileStore({
      path: join(root, "computer-profiles.json"),
    });
    const now = new Date("2026-09-08T00:00:00Z");
    let lastSeenAt = now.toISOString();
    const kernel = {
      listHosts: () => [
        { hostId: "host", instanceId: "instance", state: "online", lastSeenAt },
      ],
      listAgentCatalog: () => [],
    };
    const metadata = createDaemonWorkerProfileMetadata({
      hostId: "host",
      kernel: kernel as never,
      computerProfiles: profiles,
      registries: new Map(),
      now: () => now,
    });
    assert.equal(metadata.computer("foreign-host"), undefined);
    assert.equal(metadata.computer("host")!.connection.status, "online");
    profiles.update({
      hostId: "host",
      displayName: "Renamed Computer",
      description: "shared description",
      expectedRevision: 0,
      idempotencyKey: "rename",
    });
    const worker = metadata.computer("host")!;
    const human = buildLocalRuntimeInventoryResponse({
      hostId: "host",
      kernel: kernel as never,
      actor: {} as never,
      computerProfile: profiles.read("host")!,
      configured: [],
      discovered: [],
      now,
    });
    assert.equal(worker.displayName, human.computer!.displayName);
    assert.equal(worker.displayName, "Renamed Computer");
    assert.equal(worker.description, "shared description");
    lastSeenAt = new Date(now.getTime() - 30001).toISOString();
    assert.equal(metadata.computer("host")!.connection.status, "offline");
    assert.ok(!JSON.stringify(worker).includes(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime metadata resolves the requested immutable revision, never executable guesses or secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "rah-worker-runtime-metadata-"));
  try {
    const revision = (id: string, version: number) =>
      ({
        runtimeProfileId: "runtime",
        runtimeProfileRevisionId: id,
        manifest: {
          manifestVersion: version,
          displayName: id,
          modelCatalogProbe: { kind: "codex-cli/v1" },
          adapter: {
            executable: "/SECRET/codex",
            environment: { TOKEN: "SECRET" },
          },
        },
      }) as unknown as RuntimeProfileRevision;
    const revisions = new Map([
      ["old", revision("old", 3)],
      ["new", revision("new", 1)],
    ]);
    const metadata = createDaemonWorkerProfileMetadata({
      hostId: "host",
      kernel: { listHosts: () => [] } as never,
      computerProfiles: new LocalComputerProfileStore({
        path: join(root, "computer-profiles.json"),
      }),
      registries: new Map([
        ["registry", { getRevision: (id: string) => revisions.get(id)! }],
      ]),
    });
    const target = {
      hostId: "host",
      runtimeProfileId: "runtime",
      runtimeProfileRevisionId: "old",
    };
    assert.deepEqual(metadata.runtime(target), {
      ...target,
      displayName: "old",
      cliId: "codex",
      executionMode: "byoc",
    });
    assert.equal(
      metadata.runtime({ ...target, runtimeProfileRevisionId: "new" })!.cliId,
      undefined,
    );
    assert.equal(metadata.runtime({ ...target, hostId: "foreign" }), undefined);
    assert.equal(
      metadata.runtime({ ...target, runtimeProfileId: "other" }),
      undefined,
    );
    assert.equal(
      metadata.runtime({ ...target, runtimeProfileRevisionId: "absent" }),
      undefined,
    );
    assert.ok(!JSON.stringify(metadata.runtime(target)).includes("SECRET"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
