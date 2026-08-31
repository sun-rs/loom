import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createHash,
  sign,
  type KeyObject,
} from "node:crypto";
import { lstat, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compareComputerReleaseVersions,
  ComputerReleaseSource,
  ComputerReleaseSourceError,
  createComputerReleaseManifestSignaturePayload,
  type ComputerReleaseManifest,
} from "../src/index.ts";

const sha256 = "ab".repeat(32);

function signedManifest(
  privateKey: KeyObject,
  overrides: Partial<ComputerReleaseManifest> = {},
): ComputerReleaseManifest & { signature: string } {
  const manifest: ComputerReleaseManifest = {
    schemaVersion: 1,
    targets: {
      "darwin-arm64": {
        file: "rah-computer-darwin-arm64.tar.gz",
        sha256,
        size: 1_024,
      },
    },
    version: "2.0.0",
    ...overrides,
  };
  return {
    ...manifest,
    signature: sign(
      null,
      createComputerReleaseManifestSignaturePayload(manifest),
      privateKey,
    ).toString("base64"),
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("release source verifies signed manifest, attested size, hash, and platform target", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const requests: string[] = [];
  const source = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async (input) => {
      const url = input.toString();
      requests.push(url);
      if (url.endsWith("/manifest.json")) {
        if (url.endsWith("/2.0.0/manifest.json")) {
          return response(signedManifest(privateKey));
        }
        return response({ schemaVersion: 1, version: "2.0.0" });
      }
      return response({}, 404);
    },
    publicKey,
  });

  assert.deepEqual(
    await source.checkForUpdate({
      currentVersion: "1.9.0",
      platformKey: "darwin-arm64",
    }),
    {
      file: "rah-computer-darwin-arm64.tar.gz",
      platformKey: "darwin-arm64",
      sha256,
      size: 1_024,
      url: "https://releases.example/computer/2.0.0/rah-computer-darwin-arm64.tar.gz",
      version: "2.0.0",
    },
  );
  assert.deepEqual(requests, [
    "https://releases.example/computer/manifest.json",
    "https://releases.example/computer/2.0.0/manifest.json",
  ]);
});

test("release source fails closed on a forged signature and unsafe target metadata", async () => {
  const signer = generateKeyPairSync("ed25519");
  const trusted = generateKeyPairSync("ed25519");
  const forged = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async () => response(signedManifest(signer.privateKey)),
    publicKey: trusted.publicKey,
  });
  await assert.rejects(
    forged.fetchRelease("2.0.0", { platformKey: "darwin-arm64" }),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "manifest_signature_invalid",
  );

  const unsafeManifest = signedManifest(trusted.privateKey, {
    targets: {
      "darwin-arm64": {
        file: "../escape.tar.gz",
        sha256,
        size: 1_024,
      },
    },
  });
  const unsafe = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async () => response(unsafeManifest),
    publicKey: trusted.publicKey,
  });
  await assert.rejects(
    unsafe.fetchRelease("2.0.0", { platformKey: "darwin-arm64" }),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "manifest_invalid",
  );
});

test("release source never substitutes transport length for absent manifest size", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const malformed = signedManifest(privateKey);
  const target = malformed.targets["darwin-arm64"] as unknown as Record<
    string,
    unknown
  >;
  delete target.size;
  const source = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async () =>
      new Response(JSON.stringify(malformed), {
        headers: { "content-length": "1024" },
      }),
    publicKey,
  });
  await assert.rejects(
    source.fetchRelease("2.0.0", { platformKey: "darwin-arm64" }),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "size_unattested",
  );
});

test("release version comparison implements strict semver precedence", () => {
  assert.equal(compareComputerReleaseVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareComputerReleaseVersions("1.0.1", "1.0.0"), 1);
  assert.equal(
    compareComputerReleaseVersions("2.0.0-alpha.2", "2.0.0-alpha.10"),
    -1,
  );
  assert.equal(compareComputerReleaseVersions("2.0.0-alpha", "2.0.0"), -1);
  assert.throws(
    () => compareComputerReleaseVersions("2.0.0-01", "2.0.0"),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "version_invalid",
  );
});

test("older release pointers are no-op while unavailable pointers are failures", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const old = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async () => response({ schemaVersion: 1, version: "1.0.0" }),
    publicKey,
  });
  assert.equal(
    await old.checkForUpdate({
      currentVersion: "2.0.0",
      platformKey: "darwin-arm64",
    }),
    null,
  );

  const unavailable = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async () => response({ message: "publishing" }, 503),
    publicKey,
  });
  await assert.rejects(
    unavailable.checkForUpdate({
      currentVersion: "2.0.0",
      platformKey: "darwin-arm64",
    }),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "source_unavailable",
  );
});

test("release download is exact, owner-private, and idempotent after durable bytes", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-release-download-"));
  context.after(async () => {
    await import("node:fs/promises").then(
      async ({ rm }) => await rm(directory, { force: true, recursive: true }),
    );
  });
  const bytes = Buffer.from("signed computer release bytes", "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = signedManifest(privateKey, {
    targets: {
      "darwin-arm64": {
        file: "rah-computer-darwin-arm64.tar.gz",
        sha256: digest,
        size: bytes.byteLength,
      },
    },
  });
  let artifactRequests = 0;
  const source = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async (input) => {
      const url = input.toString();
      if (url.endsWith("/manifest.json")) return response(manifest);
      artifactRequests += 1;
      if (artifactRequests > 1) throw new Error("must reuse verified bytes");
      return new Response(bytes);
    },
    publicKey,
  });
  const destinationPath = join(directory, "stage", "computer.tar.gz");

  const first = await source.downloadVerifiedRelease({
    destinationPath,
    platformKey: "darwin-arm64",
    version: "2.0.0",
  });
  const replay = await source.downloadVerifiedRelease({
    destinationPath,
    platformKey: "darwin-arm64",
    version: "2.0.0",
  });
  assert.deepEqual(replay, first);
  assert.equal(artifactRequests, 1);
  assert.deepEqual(await readFile(destinationPath), bytes);
  assert.equal((await lstat(destinationPath)).mode & 0o077, 0);

  const { path: _path, ...verifiedRelease } = first;
  const progress: Array<readonly [number, number]> = [];
  assert.deepEqual(
    await source.materializeVerifiedRelease({
      destinationPath,
      onProgress: (downloaded, total) => {
        progress.push([downloaded, total]);
      },
      release: verifiedRelease,
    }),
    first,
  );
  assert.deepEqual(progress, [[bytes.byteLength, bytes.byteLength]]);
  await assert.rejects(
    source.materializeVerifiedRelease({
      destinationPath: join(directory, "stage", "forged.tar.gz"),
      release: {
        ...verifiedRelease,
        url: "https://attacker.example/computer",
      },
    }),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "artifact_invalid",
  );
});

test("release download removes partial bytes and refuses a symlink destination", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-release-failure-"));
  context.after(async () => {
    await import("node:fs/promises").then(
      async ({ rm }) => await rm(directory, { force: true, recursive: true }),
    );
  });
  const declaredBytes = Buffer.from("declared", "utf8");
  const wrongBytes = Buffer.from("tampered", "utf8");
  const digest = createHash("sha256").update(declaredBytes).digest("hex");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = signedManifest(privateKey, {
    targets: {
      "darwin-arm64": {
        file: "rah-computer-darwin-arm64.tar.gz",
        sha256: digest,
        size: declaredBytes.byteLength,
      },
    },
  });
  const source = new ComputerReleaseSource({
    baseUrl: "https://releases.example/computer",
    fetch: async (input) =>
      input.toString().endsWith("/manifest.json")
        ? response(manifest)
        : new Response(wrongBytes),
    publicKey,
  });
  const destinationPath = join(directory, "stage", "computer.tar.gz");
  await assert.rejects(
    source.downloadVerifiedRelease({
      destinationPath,
      platformKey: "darwin-arm64",
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "artifact_invalid",
  );
  await assert.rejects(readFile(destinationPath), { code: "ENOENT" });

  await symlink(join(directory, "outside"), destinationPath);
  await assert.rejects(
    source.downloadVerifiedRelease({
      destinationPath,
      platformKey: "darwin-arm64",
      version: "2.0.0",
    }),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "artifact_invalid",
  );
});

test("release artifact has a dedicated bounded stall timeout", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rah-release-stall-"));
  context.after(async () => {
    await import("node:fs/promises").then(
      async ({ rm }) => await rm(directory, { force: true, recursive: true }),
    );
  });
  const bytes = Buffer.from("partial", "utf8");
  const { publicKey } = generateKeyPairSync("ed25519");
  const source = new ComputerReleaseSource({
    artifactDownloadTimeoutMs: 1_000,
    artifactStallTimeoutMs: 20,
    baseUrl: "https://releases.example/computer",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
          },
        }),
      ),
    publicKey,
  });
  const release = {
    file: "computer",
    platformKey: "darwin-arm64",
    sha256: createHash("sha256")
      .update(Buffer.concat([bytes, Buffer.from("missing")]))
      .digest("hex"),
    size: bytes.byteLength + 7,
    url: "https://releases.example/computer/2.0.0/computer",
    version: "2.0.0",
  };

  await assert.rejects(
    Promise.race([
      source.materializeVerifiedRelease({
        destinationPath: join(directory, "computer"),
        release,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("stall gate timed out")), 250),
      ),
    ]),
    (error: unknown) =>
      error instanceof ComputerReleaseSourceError &&
      error.code === "artifact_download_failed",
  );
  await assert.rejects(readFile(join(directory, "computer")), {
    code: "ENOENT",
  });
});
