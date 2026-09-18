import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveDaemonBuildIdentity } from "../src/build-identity.ts";

const healthSourcePath = fileURLToPath(
  new URL("../src/daemon-health.ts", import.meta.url),
);
const repositoryDirectory = fileURLToPath(new URL("../../..", import.meta.url));

const releaseIdentity = JSON.stringify({
  schemaVersion: 1,
  kind: "release",
  version: "9.9.9",
  releaseVersion: "9.9.9",
  commit: "0123456789abcdef0123456789abcdef01234567",
  shortCommit: "0123456",
  builtAt: "2026-09-16T00:00:00.000Z",
  buildId: "00112233445566aa",
});

test("the daemon reports the identity injected at build time", () => {
  const identity = resolveDaemonBuildIdentity({
    RAH_OS_BUILD_IDENTITY: releaseIdentity,
  });

  assert.equal(identity.kind, "release");
  assert.equal(identity.version, "9.9.9");
  assert.equal(identity.buildId, "00112233445566aa");
});

test("a daemon without an injected identity is a development build, not 0.1.0", () => {
  const identity = resolveDaemonBuildIdentity({});

  assert.equal(identity.kind, "development");
  assert.match(identity.version, /^0\.0\.0-dev\+/u);
  assert.notEqual(identity.version, "0.1.0");
});

test("daemon-health carries no hardcoded product version literal", () => {
  const source = readFileSync(healthSourcePath, "utf8");

  assert.ok(
    !/"0\.1\.0"|'0\.1\.0'/u.test(source),
    "daemon-health.ts must consume the build identity instead of a literal version",
  );
  assert.match(source, /build-identity\.ts/u);
});

test("health, capabilities and the agent host build version all read the injected identity", () => {
  const printed = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        'const health = await import("./packages/daemon/src/daemon-health.ts");',
        "process.stdout.write(",
        "  JSON.stringify({",
        "    version: health.DAEMON_BUILD_VERSION,",
        "    kind: health.DAEMON_BUILD_IDENTITY.kind,",
        "    buildId: health.DAEMON_BUILD_IDENTITY.buildId,",
        "  }),",
        ");",
      ].join("\n"),
    ],
    {
      cwd: repositoryDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        RAH_OS_BUILD_IDENTITY: releaseIdentity,
      },
    },
  );

  assert.deepEqual(JSON.parse(printed), {
    version: "9.9.9",
    kind: "release",
    buildId: "00112233445566aa",
  });
});

test("the workbench /_rah/health route serves the injected identity over real HTTP", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-r4-gateway-"));
  try {
    const staticDirectory = join(directory, "dist");
    mkdirSync(staticDirectory, { recursive: true });
    writeFileSync(
      join(staticDirectory, "index.html"),
      '<!doctype html><div id="root">RAH OS</div>',
    );
    writeFileSync(
      join(staticDirectory, ".rah-web-build.json"),
      JSON.stringify({ schemaVersion: 1, webBuildId: "web-generation-local" }),
    );
    const gatewayModuleUrl = new URL(
      "../src/local-workbench-gateway.ts",
      import.meta.url,
    ).href;
    const printed = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { createServer } from "node:http";',
          `const { LocalWorkbenchGateway } = await import(${JSON.stringify(gatewayModuleUrl)});`,
          "const upstream = createServer((request, response) => {",
          '  response.setHeader("content-type", "application/json");',
          "  response.end(JSON.stringify({ ok: true }));",
          "});",
          "const upstreamOrigin = await new Promise((done) => {",
          '  upstream.listen(0, "127.0.0.1", () => {',
          "    done(`http://127.0.0.1:${upstream.address().port}`);",
          "  });",
          "});",
          "const gateway = new LocalWorkbenchGateway({",
          '  accessToken: "server-only-human-token",',
          "  daemonOrigin: upstreamOrigin,",
          "  port: 0,",
          '  sessionToken: "a".repeat(43),',
          `  staticDirectory: ${JSON.stringify(staticDirectory)},`,
          "});",
          "await gateway.start();",
          "const response = await fetch(`${gateway.origin}/_rah/health`);",
          "const observed = {",
          "  status: response.status,",
          '  cacheControl: response.headers.get("cache-control"),',
          "  body: await response.json(),",
          "};",
          "await gateway.stop();",
          "upstream.close();",
          "process.stdout.write(JSON.stringify(observed));",
        ].join("\n"),
      ],
      {
        cwd: repositoryDirectory,
        encoding: "utf8",
        env: { ...process.env, RAH_OS_BUILD_IDENTITY: releaseIdentity },
      },
    );
    const observed = JSON.parse(printed);

    assert.equal(observed.status, 200);
    assert.equal(observed.cacheControl, "no-store");
    assert.equal(observed.body.service, "rah-os-local-core");
    assert.deepEqual(observed.body.buildIdentity, JSON.parse(releaseIdentity));
    assert.deepEqual(Object.keys(observed.body).sort(), [
      "buildIdentity",
      "service",
      "state",
    ]);
    // The identity is an acceptance surface, never a credential carrier.
    for (const key of Object.keys(observed.body.buildIdentity)) {
      assert.ok(
        !/token|secret|password|key/iu.test(key),
        `health identity must not carry ${key}`,
      );
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the LAN gateway /_rah/health serves the same injected identity over real TLS", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-r4-lan-gateway-"));
  try {
    const staticDirectory = join(directory, "dist");
    const stateDirectory = join(directory, "state");
    mkdirSync(staticDirectory, { recursive: true });
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(staticDirectory, "index.html"),
      '<!doctype html><div id="root">RAH OS</div>',
    );
    writeFileSync(
      join(staticDirectory, ".rah-web-build.json"),
      JSON.stringify({ schemaVersion: 1, webBuildId: "web-generation-lan" }),
    );
    const keyPath = join(directory, "test.key");
    const certificatePath = join(directory, "test.crt");
    execFileSync(
      "/usr/bin/openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    const printed = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { readFileSync } from "node:fs";',
          'import { createServer } from "node:http";',
          'import { request as createHttpsRequest } from "node:https";',
          `const { LanWorkbenchGateway } = await import(${JSON.stringify(
            new URL("../src/lan-workbench-gateway.ts", import.meta.url).href,
          )});`,
          `const { LanWorkbenchAccessStore } = await import(${JSON.stringify(
            new URL("../src/lan-workbench-access-store.ts", import.meta.url)
              .href,
          )});`,
          "const upstream = createServer((request, response) => {",
          '  response.setHeader("content-type", "application/json");',
          "  response.end(JSON.stringify({ ok: true }));",
          "});",
          "const upstreamOrigin = await new Promise((done) => {",
          '  upstream.listen(0, "127.0.0.1", () => {',
          "    done(`http://127.0.0.1:${upstream.address().port}`);",
          "  });",
          "});",
          "const gateway = new LanWorkbenchGateway({",
          "  accessStore: new LanWorkbenchAccessStore({",
          `    path: ${JSON.stringify(join(stateDirectory, "lan-access.json"))},`,
          "  }),",
          '  accessToken: "server-only-human-token",',
          '  bindHost: "127.0.0.1",',
          "  daemonOrigin: upstreamOrigin,",
          "  port: 0,",
          '  publicHostname: "127.0.0.1",',
          `  staticDirectory: ${JSON.stringify(staticDirectory)},`,
          "  tls: {",
          `    certificate: readFileSync(${JSON.stringify(certificatePath)}),`,
          `    privateKey: readFileSync(${JSON.stringify(keyPath)}),`,
          "  },",
          "});",
          "await gateway.start();",
          "const observed = await new Promise((done, fail) => {",
          "  const call = createHttpsRequest(",
          "    `${gateway.origin}/_rah/health`,",
          "    { rejectUnauthorized: false },",
          "    (response) => {",
          '      let body = "";',
          '      response.setEncoding("utf8");',
          '      response.on("data", (chunk) => (body += chunk));',
          '      response.on("end", () =>',
          "        done({",
          "          status: response.statusCode,",
          '          cacheControl: response.headers["cache-control"],',
          "          body: JSON.parse(body),",
          "        }),",
          "      );",
          "    },",
          "  );",
          '  call.on("error", fail);',
          "  call.end();",
          "});",
          "await gateway.stop();",
          "upstream.close();",
          "process.stdout.write(JSON.stringify(observed));",
        ].join("\n"),
      ],
      {
        cwd: repositoryDirectory,
        encoding: "utf8",
        env: { ...process.env, RAH_OS_BUILD_IDENTITY: releaseIdentity },
      },
    );
    const observed = JSON.parse(printed);

    assert.equal(observed.status, 200);
    assert.equal(observed.body.service, "rah-os-local-core");
    assert.deepEqual(observed.body.buildIdentity, JSON.parse(releaseIdentity));
    assert.deepEqual(Object.keys(observed.body).sort(), [
      "buildIdentity",
      "service",
      "state",
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the daemon CLI can print its own identity without a config file", () => {
  const printed = execFileSync(
    process.execPath,
    ["packages/daemon/src/cli.ts", "--version"],
    {
      cwd: repositoryDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        RAH_OS_BUILD_IDENTITY: releaseIdentity,
      },
    },
  );

  assert.match(printed, /RAH OS 9\.9\.9/u);
  assert.match(printed, /00112233445566aa/u);
});
