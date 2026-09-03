import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { snapshotWorkbenchAssets } from "../../../scripts/workbench-web-assets.mjs";
import { diagnosticReferenceParts } from "../src/diagnostic-references.ts";
import { createLatestRequest } from "../src/latest-request.ts";

// Independent regression probes: exercise exported owners, not source-string matches.
const rooms = [
  {
    roomId: "design-room",
    slug: "design",
    name: "Design",
    kind: "channel" as const,
  },
  { roomId: "bob-room", slug: "dm-bob", name: "Bob", kind: "direct" as const },
];

async function writeFixtureBuildIdentity(
  source: string,
  webBuildId = "fixture-build",
) {
  const indexPath = join(source, "index.html");
  const index = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    `<meta name="rah-web-build-id" content="${webBuildId}">${index}`,
  );
  await writeFile(
    join(source, ".rah-web-build.json"),
    JSON.stringify({ schemaVersion: 1, webBuildId }),
  );
}

test("audit: a dotted DM handle cannot silently link to its shorter prefix", () => {
  const text = "dm:@Bob.Smith";
  const parts = diagnosticReferenceParts(text, rooms);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(
    parts.filter((part) => part.target),
    [],
  );
});

test("audit: a complete visible dotted DM handle is one reference", () => {
  const text = "dm:@Bob.Smith:1234abcd";
  const parts = diagnosticReferenceParts(text, [
    ...rooms,
    {
      roomId: "bob-smith-room",
      slug: "dm-bob-smith",
      name: "Bob.Smith",
      kind: "direct" as const,
    },
  ]);
  assert.deepEqual(parts, [
    { text, target: { roomId: "bob-smith-room", messageId: "1234abcd" } },
  ]);
});

test("audit: a known canonical DM handle is independent of its display name", () => {
  const directory = [
    {
      roomId: "architect-dm",
      slug: "dm-architect",
      name: "Architect",
      kind: "direct" as const,
      peerHandle: "coder.bot",
    },
  ];
  assert.deepEqual(diagnosticReferenceParts("dm:@CODER.BOT", directory), [
    { text: "dm:@CODER.BOT", target: { roomId: "architect-dm" } },
  ]);
  assert.equal(
    diagnosticReferenceParts("dm:@Architect", directory).some(
      (part) => part.target,
    ),
    false,
  );
});

test("audit: a sentence-ending period does not become part of a channel name", () => {
  assert.deepEqual(diagnosticReferenceParts("See #design.", rooms), [
    { text: "See " },
    { text: "#design", target: { roomId: "design-room" } },
    { text: "." },
  ]);
});

test("audit: unsupported message suffixes never degrade to a room-only navigation", () => {
  // Official short IDs can have six hex digits. The local minimum may remain
  // stricter, but the parser must retain the complete reference as plain text.
  for (const text of [
    "#design:abcdef",
    "#design:x",
    `#design:${"a".repeat(161)}`,
  ]) {
    const parts = diagnosticReferenceParts(text, rooms);
    assert.equal(parts.map((part) => part.text).join(""), text);
    for (const part of parts.filter((candidate) => candidate.target)) {
      assert.equal(
        part.text,
        text,
        "a clickable prefix changes the target's meaning",
      );
      assert.ok(
        part.target?.messageId,
        "a message reference cannot become a room link",
      );
    }
  }
});

test("audit: directory matching is case-insensitive and ambiguity stays text", () => {
  assert.deepEqual(diagnosticReferenceParts("#DESIGN", rooms), [
    { text: "#DESIGN", target: { roomId: "design-room" } },
  ]);
  assert.equal(
    diagnosticReferenceParts("#design", [
      ...rooms,
      {
        roomId: "another-design-room",
        slug: "DESIGN",
        name: "Other",
        kind: "channel" as const,
      },
    ]).some((part) => part.target),
    false,
  );
});

test("audit: actual Vite build config separates ordinary and trusted product output", async () => {
  const previousTrusted = process.env.RAH_WEB_TRUSTED_PROXY_AUTH;
  const previousDevelopmentToken = process.env.RAH_DEV_ACCESS_TOKEN;
  try {
    delete process.env.RAH_DEV_ACCESS_TOKEN;
    for (const [trusted, expectedDirectory, expectedAuth] of [
      ["0", "dist", "false"],
      ["1", "dist-workbench", "true"],
    ]) {
      process.env.RAH_WEB_TRUSTED_PROXY_AUTH = trusted;
      const url = new URL(
        `../vite.config.ts?independent-audit=${trusted}`,
        import.meta.url,
      );
      const config = (await import(url.href)).default;
      assert.equal(typeof config, "function");
      const resolved = await config({ command: "build", mode: "production" });
      assert.equal(resolved.build.outDir, expectedDirectory);
      assert.equal(resolved.define.__RAH_TRUSTED_PROXY_AUTH__, expectedAuth);
    }
  } finally {
    if (previousTrusted === undefined)
      delete process.env.RAH_WEB_TRUSTED_PROXY_AUTH;
    else process.env.RAH_WEB_TRUSTED_PROXY_AUTH = previousTrusted;
    if (previousDevelopmentToken === undefined)
      delete process.env.RAH_DEV_ACCESS_TOKEN;
    else process.env.RAH_DEV_ACCESS_TOKEN = previousDevelopmentToken;
  }
});

test("audit: frozen assets reject an entry point whose local asset is missing", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "rah-independent-assets-missing-"),
  );
  try {
    const source = join(directory, "apps/web/dist-workbench");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "index.html"),
      '<script type="module" src="/assets/missing.js"></script>',
    );
    await writeFixtureBuildIdentity(source);
    await assert.rejects(snapshotWorkbenchAssets(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit: a present Vite manifest must close over lazy chunks and their assets", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "rah-independent-assets-manifest-"),
  );
  try {
    const source = join(directory, "apps/web/dist-workbench");
    await mkdir(join(source, "assets"), { recursive: true });
    await mkdir(join(source, ".vite"), { recursive: true });
    await writeFile(
      join(source, "index.html"),
      '<script type="module" src="/assets/main.js"></script>',
    );
    await writeFile(join(source, "assets/main.js"), "main");
    await writeFixtureBuildIdentity(source);
    const entry = {
      file: "assets/main.js",
      isEntry: true,
      dynamicImports: ["lazy.ts"],
    };
    await writeFile(
      join(source, ".vite/manifest.json"),
      JSON.stringify({ "index.html": entry }),
    );
    await assert.rejects(
      snapshotWorkbenchAssets(directory),
      "missing lazy manifest key must fail",
    );
    await writeFile(
      join(source, ".vite/manifest.json"),
      JSON.stringify({
        "index.html": entry,
        "lazy.ts": { file: "assets/lazy.js", css: ["assets/lazy.css"] },
      }),
    );
    await assert.rejects(
      snapshotWorkbenchAssets(directory),
      "missing lazy JS must fail",
    );
    await writeFile(join(source, "assets/lazy.js"), "lazy");
    await assert.rejects(
      snapshotWorkbenchAssets(directory),
      "missing lazy CSS must fail",
    );
    await writeFile(join(source, "assets/lazy.css"), "body { color: black; }");
    assert.ok(await snapshotWorkbenchAssets(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit: local URL query and fragment do not become part of an asset filename", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "rah-independent-assets-url-"),
  );
  try {
    const source = join(directory, "apps/web/dist-workbench");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "index.html"),
      '<script type="module" src="/assets/main.js?v=one#entry"></script>',
    );
    await writeFile(join(source, "assets/main.js"), "main");
    await writeFixtureBuildIdentity(source);
    assert.ok(await snapshotWorkbenchAssets(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit: a later mutable build cannot change the frozen release and tampering is rejected", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "rah-independent-assets-frozen-"),
  );
  try {
    const source = join(directory, "apps/web/dist-workbench");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "index.html"),
      '<script type="module" src="/assets/main.js"></script>',
    );
    await writeFile(join(source, "assets/main.js"), "version-one");
    await writeFixtureBuildIdentity(source);
    const frozen = await snapshotWorkbenchAssets(directory);
    await writeFile(join(source, "assets/main.js"), "version-two");
    assert.equal(
      await readFile(join(frozen, "assets/main.js"), "utf8"),
      "version-one",
    );
    await writeFile(join(source, "assets/main.js"), "version-one");
    await chmod(join(frozen, "assets/main.js"), 0o644);
    await writeFile(join(frozen, "assets/main.js"), "tampered");
    await assert.rejects(snapshotWorkbenchAssets(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audit: shared navigation intent rejects superseded completion without an old component cancelling the new one", () => {
  const gate = createLatestRequest();
  let navigationEpoch = 0;
  const first = gate.begin(() => navigationEpoch === 0);
  const second = gate.begin(() => navigationEpoch === 0);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.current(), false);
  assert.equal(first.owns(), false);
  first.cancel();
  assert.equal(
    second.current(),
    true,
    "unmounting the first link must not cancel the second link",
  );
  navigationEpoch++;
  assert.equal(second.current(), false);
  assert.equal(
    second.owns(),
    true,
    "the same action may clear its pending indicator without retaining navigation authority",
  );
  const third = gate.begin();
  assert.equal(second.owns(), false);
  gate.cancel();
  assert.equal(third.current(), false);
  assert.equal(third.owns(), false);
  assert.equal(third.signal.aborted, true);
});

for (const runnerName of ["run-local-workbench.mjs", "run-lan-workbench.mjs"]) {
  test(`audit: actual ${runnerName} forwards the pinned source and serves only the resulting snapshot`, () => {
    const runnerUrl = new URL(`../../../scripts/${runnerName}`, import.meta.url)
      .href;
    const snapshotUrl = new URL(
      "../../../scripts/workbench-web-assets.mjs",
      import.meta.url,
    ).href;
    const repositoryDirectory = resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    for (const pinned of [undefined, "/independent-audit/pinned-release"]) {
      // Execute the real entry point with both external effects mocked before
      // import. The daemon stub deliberately throws before any process/server
      // lifecycle starts; the snapshot stub never touches the real repository.
      const script = `
        import assert from "node:assert/strict";
        import { mock } from "node:test";
        const expectedPinned = ${JSON.stringify(pinned) ?? "undefined"};
        const stopped = new Error("independent audit stops before daemon startup");
        const calls = [];
        mock.module(${JSON.stringify(snapshotUrl)}, { namedExports: {
          acquireWorkbenchAssetLease: async (repositoryDirectory, staticDirectory) => {
            assert.equal(repositoryDirectory, ${JSON.stringify(repositoryDirectory)});
            assert.equal(staticDirectory, "/independent-audit/frozen-result");
            calls.push("lease");
            return { release: async () => calls.push("release") };
          },
          pruneWorkbenchAssetSnapshots: async () => {
            calls.push("prune");
          },
          snapshotWorkbenchAssets: async (repositoryDirectory, pinnedDirectory) => {
            assert.equal(pinnedDirectory, expectedPinned);
            assert.equal(repositoryDirectory, ${JSON.stringify(repositoryDirectory)});
            calls.push("snapshot");
            return "/independent-audit/frozen-result";
          }
        }});
        mock.module("@rah-os/daemon/local-workbench", { namedExports: {
          prepareRahDataHome: async () => {
            calls.push("prepare");
            return "/independent-audit/home";
          },
          startLocalCoreWorkbench: async options => {
            assert.deepEqual(calls, ["prepare", "snapshot", "lease"]);
            assert.equal(options.staticDirectory, "/independent-audit/frozen-result");
            assert.equal(options.workbenchHome, "/independent-audit/home");
            calls.push("start");
            throw stopped;
          }
        }});
        await assert.rejects(import(${JSON.stringify(runnerUrl)}), error => error === stopped);
        assert.deepEqual(calls, ["prepare", "snapshot", "lease", "start", "release"]);
      `;
      execFileSync(
        process.execPath,
        [
          "--experimental-test-module-mocks",
          "--input-type=module",
          "--eval",
          script,
        ],
        {
          cwd: new URL("../../../", import.meta.url),
          env: {
            RAH_OS_HOME: "/independent-audit/home",
            RAH_WORKSPACE_CWD: "/independent-audit/workspace",
            RAH_LAN_ORIGIN: "https://audit.invalid",
            ...(pinned ? { RAH_WEB_STATIC_DIRECTORY: pinned } : {}),
          },
          stdio: "pipe",
          timeout: 10_000,
        },
      );
    }
  });
}
