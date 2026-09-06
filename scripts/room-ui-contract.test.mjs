import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateRoomUiContract } from "./room-ui-contract.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "rah-room-ui-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactPath = "docs/ui/evidence/example.json";
  const artifact = {
    schemaVersion: 1,
    artifactId: "example-evidence",
    source: {
      type: "official-browser-observation",
      upstreamIdentifier: "https://example.invalid/room",
      upstreamVersion: "fixture-build-1",
      capturedAt: "2026-09-06T00:00:00.000Z",
    },
    extraction: {
      method: "fixture observation",
      location: "Room shell at the desktop breakpoint",
      content: { contracts: { shell: { dividerWidth: 2 } } },
    },
  };
  const artifactBytes = `${JSON.stringify(artifact, null, 2)}\n`;
  writeJson(root, artifactPath, artifact);
  const artifactSha = sha256(artifactBytes);
  writeJson(root, "docs/ui/evidence/manifest.json", {
    schemaVersion: 1,
    artifacts: [
      {
        artifactId: artifact.artifactId,
        path: artifactPath,
        sha256: artifactSha,
        sourceType: artifact.source.type,
        upstreamIdentifier: artifact.source.upstreamIdentifier,
        upstreamVersion: artifact.source.upstreamVersion,
      },
    ],
  });
  writeJson(root, "docs/ui/raft-behavior-registry.json", {
    schemaVersion: 1,
    baseline: {
      policy: "official-evidence-first",
      evidenceManifest: "docs/ui/evidence/manifest.json",
    },
    contracts: [
      {
        id: "example-contract",
        classification: "reference-rebuilt",
        sourceArtifact: artifactPath,
        sourceSha256: artifactSha,
        sourceLocator: "/extraction/content/contracts/shell",
        owner: "owner.ts",
        tests: ["owner.test.ts"],
      },
    ],
  });
  writeFileSync(path.join(root, "owner.ts"), "export {};\n");
  writeFileSync(path.join(root, "owner.test.ts"), "export {};\n");
  return { artifactPath, artifactSha, root };
}

test("accepts repo-owned evidence whose manifest, registry and bytes agree", (t) => {
  const { root } = fixture(t);
  const result = validateRoomUiContract({ root, productionFiles: [] });
  assert.equal(result.contractCount, 1);
  assert.equal(result.artifactCount, 1);
});

test("rejects a descriptive sourceArtifact that is not a repository file", (t) => {
  const { root } = fixture(t);
  const registryPath = path.join(root, "docs/ui/raft-behavior-registry.json");
  const registry = readFile(registryPath);
  registry.contracts[0].sourceArtifact = "Raft Web observed Room shell";
  writeJson(root, "docs/ui/raft-behavior-registry.json", registry);
  assert.throws(
    () => validateRoomUiContract({ root, productionFiles: [] }),
    /missing sourceArtifact|repository-relative sourceArtifact/,
  );
});

test("rejects evidence when the registry hash does not match its bytes", (t) => {
  const { root } = fixture(t);
  const registryPath = path.join(root, "docs/ui/raft-behavior-registry.json");
  const registry = readFile(registryPath);
  registry.contracts[0].sourceSha256 = "0".repeat(64);
  writeJson(root, "docs/ui/raft-behavior-registry.json", registry);
  assert.throws(
    () => validateRoomUiContract({ root, productionFiles: [] }),
    /sourceSha256 does not match/,
  );
});

test("rejects a locator that does not resolve inside the evidence artifact", (t) => {
  const { root } = fixture(t);
  const registryPath = path.join(root, "docs/ui/raft-behavior-registry.json");
  const registry = readFile(registryPath);
  registry.contracts[0].sourceLocator = "/extraction/content/contracts/missing";
  writeJson(root, "docs/ui/raft-behavior-registry.json", registry);
  assert.throws(
    () => validateRoomUiContract({ root, productionFiles: [] }),
    /sourceLocator does not resolve/,
  );
});

test("rejects an official-original claim backed only by browser observation", (t) => {
  const { root } = fixture(t);
  const registryPath = path.join(root, "docs/ui/raft-behavior-registry.json");
  const registry = readFile(registryPath);
  registry.contracts[0].classification = "official-original";
  writeJson(root, "docs/ui/raft-behavior-registry.json", registry);
  assert.throws(
    () => validateRoomUiContract({ root, productionFiles: [] }),
    /official-original requires source type official-shipped-artifact/,
  );
});

test("recursively rejects external reference imports from any production entry", (t) => {
  const { root } = fixture(t);
  const productionRoot = path.join(root, "packages/client-web/src/nested");
  mkdirSync(productionRoot, { recursive: true });
  writeFileSync(
    path.join(productionRoot, "late-entry.ts"),
    'import value from "../../../../raft-ui/source";\nexport { value };\n',
  );
  assert.throws(
    () =>
      validateRoomUiContract({
        root,
        productionRoots: ["packages/client-web/src"],
      }),
    /imports an external reference checkout/,
  );
});

test("rejects external reference checkouts in package and build configuration", (t) => {
  const { root } = fixture(t);
  writeJson(root, "packages/client-web/package.json", {
    dependencies: { reference: "file:../../../../raft-ui" },
  });
  assert.throws(
    () =>
      validateRoomUiContract({
        root,
        productionFiles: [],
        dependencyPolicyFiles: ["packages/client-web/package.json"],
      }),
    /configures an external reference checkout/,
  );
});

test("rejects symbolic links in production source", (t) => {
  const { root } = fixture(t);
  const productionRoot = path.join(root, "packages/client-web/src");
  mkdirSync(productionRoot, { recursive: true });
  const externalRoot = mkdtempSync(path.join(tmpdir(), "rah-room-ui-external-"));
  t.after(() => rmSync(externalRoot, { recursive: true, force: true }));
  const externalFile = path.join(externalRoot, "reference.ts");
  writeFileSync(externalFile, "export const reference = true;\n");
  symlinkSync(externalFile, path.join(productionRoot, "reference.ts"));
  assert.throws(
    () =>
      validateRoomUiContract({
        root,
        productionRoots: ["packages/client-web/src"],
      }),
    /must not be a symbolic link/,
  );
});

test("rejects external reference literals in public assets", (t) => {
  const { root } = fixture(t);
  const publicRoot = path.join(root, "packages/client-web/public");
  mkdirSync(publicRoot, { recursive: true });
  writeFileSync(
    path.join(publicRoot, "loader.js"),
    'window.reference = "../../../../raft-ui/dist/index.js";\n',
  );
  assert.throws(
    () =>
      validateRoomUiContract({
        root,
        productionFiles: [],
        dependencyPolicyFiles: [],
        assetRoots: ["packages/client-web/public"],
      }),
    /references an external reference checkout/,
  );
});

function readFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}
