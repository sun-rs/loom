import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildLocalRuntimeInventoryResponse,
  discoverKnownLocalClis,
  mergeLocalRuntimeInventory,
} from "../src/local-runtime-inventory.ts";

test("configured Runtime availability follows the current canonical Offer", () => {
  const response = buildLocalRuntimeInventoryResponse({
    actor: {} as never,
    configured: [
      {
        available: true,
        displayName: "Codex",
        executable: "codex",
        modelBindingDescriptors: [],
        runtimeOfferId: "runtime-offer-codex",
        runtimeProfileId: "runtime-profile-codex",
        runtimeProfileRevisionId: "runtime-profile-revision-codex",
      },
    ],
    discovered: [],
    hostId: "host-1",
    kernel: {
      listAgentCatalog: () => [],
      listHosts: () => [],
      runtimeOfferIsCurrentlyAvailable: () => false,
    } as never,
  });

  assert.equal(response.runtimes[0]?.available, false);
});

test("Computer connection is heartbeat evidence, independent of CLI readiness", () => {
  const now = new Date("2026-08-31T00:01:00Z");
  let state = "online",
    lastSeenAt = now.toISOString();
  const input = {
    actor: {} as never,
    configured: [],
    discovered: [],
    hostId: "host-1",
    now,
    kernel: {
      listAgentCatalog: () => [],
      listHosts: () => [
        {
          hostId: "host-1",
          instanceId: "generation-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          state,
          lastSeenAt,
          buildVersion: "test",
        },
      ],
    } as never,
  };
  assert.equal(
    buildLocalRuntimeInventoryResponse(input).computer?.createdAt,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(
    buildLocalRuntimeInventoryResponse(input).computer?.status,
    "online",
  );
  lastSeenAt = "2026-08-31T00:00:00Z";
  assert.equal(
    buildLocalRuntimeInventoryResponse(input).computer?.status,
    "offline",
  );
  lastSeenAt = now.toISOString();
  state = "draining";
  assert.equal(
    buildLocalRuntimeInventoryResponse(input).computer?.status,
    "draining",
  );
  state = "offline";
  assert.equal(
    buildLocalRuntimeInventoryResponse(input).computer?.status,
    "offline",
  );
});

test("Computer inventory overlays durable user profile without replacing heartbeat evidence", () => {
  const now = new Date("2026-09-02T08:00:00.000Z");
  const response = buildLocalRuntimeInventoryResponse({
    actor: {} as never,
    computerProfile: {
      description: "主要开发机",
      displayName: "RAH Studio",
      hostId: "host-1",
      revision: 3,
      updatedAt: "2026-09-02T07:59:00.000Z",
    },
    configured: [],
    discovered: [],
    hostId: "host-1",
    kernel: {
      listAgentCatalog: () => [],
      listHosts: () => [],
    } as never,
    now,
  });
  assert.equal(response.computer?.displayName, "RAH Studio");
  assert.equal(response.computer?.description, "主要开发机");
  assert.equal(response.computer?.profileRevision, 3);
  assert.equal(response.computer?.profileUpdatedAt, "2026-09-02T07:59:00.000Z");
  assert.equal(response.computer?.observedAt, now.toISOString());
  assert.equal(response.computer?.status, "unknown");
});

test("configured Runtime identity suppresses the discovery alias for the same executable", () => {
  const resolvedExecutablePath = "/opt/local/bin/codex-real";
  const inventory = mergeLocalRuntimeInventory({
    configured: [
      {
        agentBindings: [],
        available: true,
        displayName: "Codex · local account default",
        executable: resolvedExecutablePath,
        modelBindingDescriptors: [],
        resolvedExecutablePath,
        runtimeOfferId: "runtime-offer-codex",
        runtimeProfileId: "runtime-profile-codex",
        runtimeProfileRevisionId: "runtime-profile-revision-codex",
      },
    ],
    discovered: [
      {
        agentBindings: [],
        available: true,
        configured: false,
        displayName: "Codex",
        executable: "codex",
        modelBindingDescriptors: [],
        resolvedExecutablePath,
        source: "discovered",
        version: "codex-cli 0.149.1",
      },
    ],
  });

  assert.equal(inventory.length, 1);
  assert.equal(inventory[0]?.source, "configured");
  assert.equal(inventory[0]?.version, "codex-cli 0.149.1");
});

test("configured and discovered Runtimes remain distinct when their resolved executables differ", () => {
  const inventory = mergeLocalRuntimeInventory({
    configured: [
      {
        agentBindings: [],
        available: true,
        displayName: "Codex · pinned install",
        executable: "codex",
        modelBindingDescriptors: [],
        resolvedExecutablePath: "/Applications/RAH/bin/codex",
        runtimeOfferId: "runtime-offer-codex",
        runtimeProfileId: "runtime-profile-codex",
        runtimeProfileRevisionId: "runtime-profile-revision-codex",
      },
    ],
    discovered: [
      {
        agentBindings: [],
        available: true,
        configured: false,
        displayName: "Codex",
        executable: "codex",
        modelBindingDescriptors: [],
        resolvedExecutablePath: "/opt/homebrew/bin/codex",
        source: "discovered",
      },
    ],
  });

  assert.equal(inventory.length, 2);
  assert.deepEqual(
    inventory.map(({ source }) => source),
    ["configured", "discovered"],
  );
});

test("local CLI discovery resolves executable identity and bounded version without a shell", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-local-cli-discovery-"));
  try {
    for (const [name, version] of [
      ["codex", "codex-cli test"],
      ["kimi", "kimi test"],
    ] as const) {
      const executable = join(directory, name);
      writeFileSync(
        executable,
        `#!/bin/sh\n/usr/bin/printf '%s\\n' '${version}'\n`,
        { mode: 0o700 },
      );
      chmodSync(executable, 0o700);
    }

    const inventory = await discoverKnownLocalClis({
      environment: { PATH: directory },
      // This is the positive-path assertion, not the timeout gate. Keep enough
      // headroom for a fully loaded serial suite; production discovery remains
      // independently bounded by its 2s default.
      versionTimeoutMs: 10_000,
    });
    const codex = inventory.find(({ executable }) => executable === "codex");
    const kimi = inventory.find(({ executable }) => executable === "kimi");
    const claude = inventory.find(({ executable }) => executable === "claude");
    assert.equal(codex?.available, true);
    assert.equal(
      codex?.resolvedExecutablePath,
      realpathSync(join(directory, "codex")),
    );
    assert.equal(codex?.version, "codex-cli test");
    assert.equal(kimi?.version, "kimi test");
    assert.equal(claude?.available, false);
    assert.equal(claude?.configured, false);
    assert.equal(claude?.source, "discovered");
    assert.deepEqual(codex?.modelBindingDescriptors, []);
    assert.deepEqual(claude?.modelBindingDescriptors, []);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
