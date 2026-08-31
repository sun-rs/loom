import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ComputerReleasePublisherError,
  createComputerReleaseManifestSignaturePayload,
  publishComputerRelease,
  type ComputerReleaseManifest,
} from "../src/index.ts";

async function fixture(context: test.TestContext): Promise<{
  artifactPath: string;
  privateKey: KeyObject;
  privateKeyPath: string;
  publicKey: KeyObject;
  rootDirectory: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "rah-release-publisher-"));
  context.after(async () => {
    await import("node:fs/promises").then(
      async ({ rm }) => await rm(directory, { force: true, recursive: true }),
    );
  });
  await chmod(directory, 0o700);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = join(directory, "release-private.pem");
  await writeFile(
    privateKeyPath,
    privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  const artifactPath = join(directory, "rah-os-computer");
  await writeFile(artifactPath, Buffer.from("self-contained computer bytes"), {
    mode: 0o500,
  });
  const rootDirectory = join(directory, "published");
  return {
    artifactPath,
    privateKey,
    privateKeyPath,
    publicKey,
    rootDirectory,
  };
}

test("release publisher atomically publishes signed immutable bytes before the mutable pointer", async (context) => {
  const input = await fixture(context);
  const result = await publishComputerRelease({
    privateKeyPath: input.privateKeyPath,
    rootDirectory: input.rootDirectory,
    targets: [
      {
        artifactPath: input.artifactPath,
        file: "rah-os-computer-darwin-arm64",
        platformKey: "darwin-arm64",
      },
    ],
    version: "2.0.0",
  });

  const pointer = JSON.parse(
    await readFile(join(input.rootDirectory, "manifest.json"), "utf8"),
  ) as unknown;
  assert.deepEqual(pointer, { schemaVersion: 1, version: "2.0.0" });

  const envelope = JSON.parse(
    await readFile(join(input.rootDirectory, "2.0.0", "manifest.json"), "utf8"),
  ) as ComputerReleaseManifest & { signature: string };
  const { signature, ...manifest } = envelope;
  assert.equal(
    verify(
      null,
      createComputerReleaseManifestSignaturePayload(manifest),
      input.publicKey,
      Buffer.from(signature, "base64"),
    ),
    true,
  );
  const bytes = await readFile(
    join(input.rootDirectory, "2.0.0", "rah-os-computer-darwin-arm64"),
  );
  assert.equal(
    envelope.targets["darwin-arm64"]?.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(envelope.targets["darwin-arm64"]?.size, bytes.byteLength);
  assert.equal((await lstat(result.manifestPath)).mode & 0o077, 0);
  assert.equal((await lstat(result.pointerPath)).mode & 0o077, 0);

  assert.deepEqual(
    await publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [
        {
          artifactPath: input.artifactPath,
          file: "rah-os-computer-darwin-arm64",
          platformKey: "darwin-arm64",
        },
      ],
      version: "2.0.0",
    }),
    result,
  );
});

test("release publisher refuses rollback and conflicting immutable release bytes", async (context) => {
  const input = await fixture(context);
  const target = {
    artifactPath: input.artifactPath,
    file: "rah-os-computer-darwin-arm64",
    platformKey: "darwin-arm64",
  } as const;
  await publishComputerRelease({
    privateKeyPath: input.privateKeyPath,
    rootDirectory: input.rootDirectory,
    targets: [target],
    version: "2.0.0",
  });

  await assert.rejects(
    publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [target],
      version: "1.9.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleasePublisherError &&
      error.code === "pointer_rollback",
  );
  await assert.rejects(lstat(join(input.rootDirectory, "1.9.0")));

  await chmod(input.artifactPath, 0o600);
  await writeFile(input.artifactPath, Buffer.from("different bytes"));
  await assert.rejects(
    publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [target],
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleasePublisherError &&
      error.code === "immutable_conflict",
  );
});

test("release publisher rejects unsafe signing keys, artifacts, and ambiguous targets", async (context) => {
  const input = await fixture(context);
  await chmod(input.privateKeyPath, 0o644);
  await assert.rejects(
    publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [
        {
          artifactPath: input.artifactPath,
          file: "rah-os-computer-darwin-arm64",
          platformKey: "darwin-arm64",
        },
      ],
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleasePublisherError &&
      error.code === "signing_key_invalid",
  );

  await chmod(input.privateKeyPath, 0o600);
  const artifactLink = join(input.rootDirectory, "artifact-link");
  await import("node:fs/promises").then(async ({ mkdir }) => {
    await mkdir(input.rootDirectory, { mode: 0o700 });
  });
  await symlink(input.artifactPath, artifactLink);
  await assert.rejects(
    publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [
        {
          artifactPath: artifactLink,
          file: "rah-os-computer-darwin-arm64",
          platformKey: "darwin-arm64",
        },
      ],
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleasePublisherError &&
      error.code === "artifact_invalid",
  );

  await assert.rejects(
    publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [
        {
          artifactPath: input.artifactPath,
          file: "shared-artifact",
          platformKey: "darwin-arm64",
        },
        {
          artifactPath: input.artifactPath,
          file: "shared-artifact",
          platformKey: "linux-x64",
        },
      ],
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleasePublisherError &&
      error.code === "target_invalid",
  );

  await assert.rejects(
    publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [
        {
          artifactPath: input.artifactPath,
          file: "rah-os-computer-darwin-arm64",
          platformKey: "darwin-arm64",
          unexpected: true,
        } as unknown as {
          artifactPath: string;
          file: string;
          platformKey: string;
        },
      ],
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleasePublisherError &&
      error.code === "target_invalid",
  );

  const lockPath = join(input.rootDirectory, ".publish.lock");
  await writeFile(lockPath, "another publisher\n", { mode: 0o600 });
  await assert.rejects(
    publishComputerRelease({
      privateKeyPath: input.privateKeyPath,
      rootDirectory: input.rootDirectory,
      targets: [
        {
          artifactPath: input.artifactPath,
          file: "rah-os-computer-darwin-arm64",
          platformKey: "darwin-arm64",
        },
      ],
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleasePublisherError &&
      error.code === "publication_locked",
  );
  assert.equal(await readFile(lockPath, "utf8"), "another publisher\n");
});
