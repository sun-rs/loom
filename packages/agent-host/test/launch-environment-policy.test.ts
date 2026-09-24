import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RuntimeLaunchEnvironmentSchema } from "@rah-os/protocol";

import {
  GenericProcessAdapter,
  type ActivationEnvelope,
} from "../src/index.ts";
import {
  ACTIVATION_IDENTITY_FENCE_KEYS,
  filterUserLaunchEnvironment,
  resolveActivationEnvironment,
} from "../src/launch-environment-policy.ts";
import {
  providerLaunchDefaults,
  providerLaunchArguments,
} from "../src/provider-launch-arguments.js";

const adapterSourcePath = fileURLToPath(
  new URL("../src/generic-process-adapter.ts", import.meta.url),
);

/**
 * Host service credentials, internal transports and deployment locations that
 * can appear in the daemon environment. Every value is a canary: no Provider
 * child, argv, diagnostic stream or failure message may carry it.
 */
const HOST_CANARY_ENVIRONMENT = {
  RAH_AGENT_MEMORY_DIR: "CANARY-agent-memory-dir",
  RAH_AGENT_MEMORY_INDEX: "CANARY-agent-memory-index",
  RAH_AGENT_MEMORY_SYSTEM_SHA256: "CANARY-system-memory-digest",
  RAH_DATA_HOME: "CANARY-data-home",
  RAH_DEV_DIAGNOSTIC_TOKEN: "CANARY-dev-diagnostic",
  RAH_LAN_CERT_PATH: "CANARY-lan-cert",
  RAH_LAN_KEY_PATH: "CANARY-lan-private-key",
  RAH_LAN_ORIGIN: "CANARY-lan-origin",
  RAH_OS_BUILD_IDENTITY: "CANARY-build-identity",
  RAH_PROCESS_SUPERVISOR_TOKEN: "CANARY-supervisor-token",
  RAH_RESIDENT_RUNNER_CONFIG: "CANARY-resident-config",
  RAH_RESIDENT_RUNNER_TOKEN: "CANARY-resident-token",
  RAH_STATE_DIRECTORY: "CANARY-state-directory",
  RAH_TRUSTED_LAN_HOSTS: "CANARY-trusted-lan-hosts",
  RAH_WEB_PORT: "CANARY-web-port",
  RAH_WORKER_SESSION_FILE: "CANARY-worker-session-file",
  RAH_WORKER_TOKEN: "CANARY-worker-token",
} as const;

/** Developer environment that must survive unchanged. */
const PRESERVED_ENVIRONMENT = {
  CLAUDE_CONFIG_DIR: "/preserved/claude-config",
  CODEX_HOME: "/preserved/codex-home",
  HOME: "/preserved/home",
  HTTPS_PROXY: "http://127.0.0.1:8080",
  HTTP_PROXY: "http://127.0.0.1:8080",
  LANG: "en_US.UTF-8",
  NODE_EXTRA_CA_CERTS: "/preserved/extra-ca.pem",
  NO_PROXY: "localhost,127.0.0.1",
  PATH: "/preserved/bin",
  SSL_CERT_FILE: "/preserved/cert.pem",
  TERM: "xterm-256color",
} as const;

const PROBE_KEYS = Object.keys(PRESERVED_ENVIRONMENT);

const CHILD_PROBE_SCRIPT = `
const canaries = Object.entries(process.env)
  .filter(([, value]) => typeof value === "string" && value.includes("CANARY-"))
  .map(([key]) => key)
  .sort();
const rah = Object.keys(process.env)
  .filter((key) => key.startsWith("RAH_"))
  .sort();
const probe = {};
for (const key of ${JSON.stringify(PROBE_KEYS)}) probe[key] = process.env[key];
process.stdout.write(JSON.stringify({ canaries, probe, rah, path: process.env.PATH }));
`;

function activationEnvelope(): ActivationEnvelope {
  return {
    activationId: "activation-env-policy",
    consumerId: "env-policy:runtime",
    fromSeq: 1,
    hostId: "host-env-policy",
    participantId: "agent-env-policy",
    reason: "mention",
    roomId: "room-env-policy",
    runAttemptId: "run-env-policy",
    toSeq: 2,
  };
}

function expectedFenceEnvironment(): Record<string, string> {
  const input = activationEnvelope();
  return {
    RAH_ACTIVATION_ID: input.activationId,
    RAH_ACTIVATION_REASON: input.reason,
    RAH_CONSUMER_ID: input.consumerId,
    RAH_FROM_SEQ: String(input.fromSeq),
    RAH_HOST_ID: input.hostId,
    RAH_PARTICIPANT_ID: input.participantId,
    RAH_ROOM_ID: input.roomId,
    RAH_RUN_ATTEMPT_ID: input.runAttemptId,
    RAH_TO_SEQ: String(input.toSeq),
  };
}

async function withHostCanaryEnvironment<T>(run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({
    ...HOST_CANARY_ENVIRONMENT,
    ...PRESERVED_ENVIRONMENT,
  })) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function startProbe(
  adapter: GenericProcessAdapter,
): Promise<{ stderr: string; stdout: string }> {
  const run = await adapter.start(activationEnvelope(), {
    registerPrepared: async () => undefined,
  });
  const exit = await adapter.reap(run);
  const diagnostics = adapter.diagnostics(run);
  assert.equal(exit.code, 0, diagnostics.stderr);
  return diagnostics;
}

test("resolveActivationEnvironment drops host RAH service variables and keeps developer environment", () => {
  const environment = resolveActivationEnvironment({
    configured: {},
    fences: expectedFenceEnvironment(),
    inherited: { ...HOST_CANARY_ENVIRONMENT, ...PRESERVED_ENVIRONMENT },
  });

  for (const key of Object.keys(HOST_CANARY_ENVIRONMENT)) {
    assert.equal(environment[key], undefined, key);
  }
  for (const [key, value] of Object.entries(PRESERVED_ENVIRONMENT)) {
    assert.equal(environment[key], value, key);
  }
  assert.deepEqual(
    Object.keys(environment)
      .filter((key) => key.startsWith("RAH_"))
      .sort(),
    Object.keys(expectedFenceEnvironment()).sort(),
  );
});

test("resolveActivationEnvironment keeps the controlled Worker carrier and PATH-first tool wrapper", () => {
  const environment = resolveActivationEnvironment({
    configured: {
      RAH_AGENT_MEMORY_SYSTEM_SHA256: "untrusted-static-memory-proof",
      RAH_WORKER_API_URL: "https://untrusted-static.example.test",
      RAH_WORKER_TOKEN: "static-legacy-token",
    },
    fences: expectedFenceEnvironment(),
    inherited: { ...HOST_CANARY_ENVIRONMENT, ...PRESERVED_ENVIRONMENT },
    leased: {
      RAH_AGENT_TOOL_BIN: "/leased/tool-bin",
      RAH_WORKER_API_URL: "http://127.0.0.1:43123",
      RAH_WORKER_SESSION_FILE: "/leased/session",
      RAH_WORKER_TOKEN: "leased-legacy-token",
    },
  });

  assert.equal(environment.RAH_AGENT_MEMORY_SYSTEM_SHA256, undefined);
  assert.equal(environment.RAH_WORKER_API_URL, "http://127.0.0.1:43123");
  assert.equal(environment.RAH_WORKER_SESSION_FILE, "/leased/session");
  assert.equal(environment.RAH_WORKER_TOKEN, undefined);
  assert.equal(environment.RAH_AGENT_TOOL_BIN, undefined);
  assert.equal(
    environment.PATH,
    `/leased/tool-bin${delimiter}${PRESERVED_ENVIRONMENT.PATH}`,
  );
});

test("resolveActivationEnvironment refuses lease and configured overrides of the Activation identity fence", () => {
  const fences = expectedFenceEnvironment();
  const environment = resolveActivationEnvironment({
    configured: { RAH_ACTIVATION_ID: "configured-override" },
    fences,
    inherited: { ...PRESERVED_ENVIRONMENT },
    leased: {
      RAH_HOST_ID: "leased-override",
      RAH_ROOM_ID: "leased-override",
    },
  });

  for (const key of ACTIVATION_IDENTITY_FENCE_KEYS) {
    if (fences[key] === undefined) continue;
    assert.equal(environment[key], fences[key], key);
  }
});

test("S2-0: the leftover-process tags are Host fences no other layer can forge", () => {
  const environment = resolveActivationEnvironment({
    configured: { LOOM_RUNTIME_ID: "configured-forged", LOOM_RUN_ID: "x" },
    fences: {
      ...expectedFenceEnvironment(),
      LOOM_RUNTIME_ID: "process:host-runtime",
      LOOM_RUN_ID: "run-host",
    },
    inherited: {
      ...PRESERVED_ENVIRONMENT,
      LOOM_RUNTIME_ID: "process:outer-runtime",
      LOOM_RUN_ID: "run-outer",
    },
    leased: { LOOM_RUNTIME_ID: "leased-forged" },
  });
  assert.equal(environment.LOOM_RUNTIME_ID, "process:host-runtime");
  assert.equal(environment.LOOM_RUN_ID, "run-host");
  assert.ok(ACTIVATION_IDENTITY_FENCE_KEYS.includes("LOOM_RUNTIME_ID"));
  assert.ok(ACTIVATION_IDENTITY_FENCE_KEYS.includes("LOOM_RUN_ID"));
  assert.deepEqual(
    filterUserLaunchEnvironment({ LOOM_RUNTIME_ID: "user" }).rejected,
    ["LOOM_RUNTIME_ID"],
  );
});

test("filterUserLaunchEnvironment rejects platform fences and keeps explicit Provider configuration", () => {
  const filtered = filterUserLaunchEnvironment({
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
    CODEX_HOME: "/user/codex-home",
    DYLD_INSERT_LIBRARIES: "/user/inject.dylib",
    HOME: "/user/other-home",
    HTTPS_PROXY: "http://user-proxy.invalid:3128",
    NODE_OPTIONS: "--require /user/inject.js",
    PATH: "/user/bin",
    RAH_ACTIVATION_ID: "user-forged-activation",
    RAH_WORKER_SESSION_FILE: "/user/session",
  });

  assert.deepEqual(filtered.environment, {
    CODEX_HOME: "/user/codex-home",
    HTTPS_PROXY: "http://user-proxy.invalid:3128",
  });
  assert.deepEqual(filtered.rejected, [
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
    "DYLD_INSERT_LIBRARIES",
    "HOME",
    "NODE_OPTIONS",
    "PATH",
    "RAH_ACTIVATION_ID",
    "RAH_WORKER_SESSION_FILE",
  ]);
});

test("filterUserLaunchEnvironment agrees with the per-Agent override schema at the typed boundary", () => {
  for (const key of [
    "RAH_ACTIVATION_ID",
    "RAH_WORKER_SESSION_FILE",
    "HOME",
    "PATH",
    "NODE_OPTIONS",
    "DYLD_INSERT_LIBRARIES",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
    "LOOM_RUNTIME_ID",
    "LOOM_RUN_ID",
  ]) {
    assert.equal(
      RuntimeLaunchEnvironmentSchema.safeParse({ [key]: "x" }).success,
      false,
      key,
    );
    assert.deepEqual(
      filterUserLaunchEnvironment({ [key]: "x" }).environment,
      {},
    );
  }
  const legitimate = { CODEX_HOME: "/user/codex-home" };
  assert.equal(
    RuntimeLaunchEnvironmentSchema.safeParse(legitimate).success,
    true,
  );
  assert.deepEqual(
    filterUserLaunchEnvironment(legitimate).environment,
    legitimate,
  );
});

test("four Provider profiles keep argv and configuration-directory discovery under the policy", () => {
  const environment = resolveActivationEnvironment({
    configured: {},
    fences: expectedFenceEnvironment(),
    inherited: { ...HOST_CANARY_ENVIRONMENT, ...PRESERVED_ENVIRONMENT },
  });
  assert.equal(environment.CODEX_HOME, PRESERVED_ENVIRONMENT.CODEX_HOME);
  assert.equal(
    environment.CLAUDE_CONFIG_DIR,
    PRESERVED_ENVIRONMENT.CLAUDE_CONFIG_DIR,
  );

  for (const runtimeId of ["codex", "claude", "kimi", "opencode"]) {
    assert.deepEqual(
      providerLaunchArguments(runtimeId, environment),
      providerLaunchDefaults(runtimeId),
      runtimeId,
    );
  }
});

test("GenericProcessAdapter keeps host canaries out of the Provider child, argv and diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-env-canary-"));
  try {
    await withHostCanaryEnvironment(async () => {
      const toolBin = join(directory, "tool-bin");
      const adapter = new GenericProcessAdapter({
        activationEnvironment: () => ({
          env: {
            RAH_AGENT_TOOL_BIN: toolBin,
            RAH_WORKER_API_URL: "http://127.0.0.1:43123",
            RAH_WORKER_SESSION_FILE: join(directory, "session"),
          },
        }),
        args: ["-e", CHILD_PROBE_SCRIPT],
        command: process.execPath,
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
      });

      const diagnostics = await startProbe(adapter);
      const observed = JSON.parse(diagnostics.stdout) as {
        canaries: string[];
        path: string;
        probe: Record<string, string | undefined>;
        rah: string[];
      };

      assert.deepEqual(observed.canaries, []);
      assert.deepEqual(
        observed.rah,
        [
          ...Object.keys(expectedFenceEnvironment()),
          "RAH_WORKER_API_URL",
          "RAH_WORKER_SESSION_FILE",
        ].sort(),
      );
      assert.equal(observed.probe.HOME, PRESERVED_ENVIRONMENT.HOME);
      assert.equal(
        observed.probe.CLAUDE_CONFIG_DIR,
        PRESERVED_ENVIRONMENT.CLAUDE_CONFIG_DIR,
      );
      assert.equal(observed.probe.CODEX_HOME, PRESERVED_ENVIRONMENT.CODEX_HOME);
      assert.equal(
        observed.probe.NODE_EXTRA_CA_CERTS,
        PRESERVED_ENVIRONMENT.NODE_EXTRA_CA_CERTS,
      );
      assert.equal(
        observed.probe.HTTPS_PROXY,
        PRESERVED_ENVIRONMENT.HTTPS_PROXY,
      );
      assert.equal(observed.probe.TERM, PRESERVED_ENVIRONMENT.TERM);
      assert.equal(observed.path.startsWith(`${toolBin}${delimiter}`), true);
      assert.equal(diagnostics.stderr.includes("CANARY-"), false);
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("GenericProcessAdapter launch failures never quote host canaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-env-canary-failure-"));
  try {
    await withHostCanaryEnvironment(async () => {
      const adapter = new GenericProcessAdapter({
        command: join(directory, "executable-does-not-exist"),
        cwd: directory,
        supervisorDirectory: join(directory, "supervisors"),
      });
      await assert.rejects(
        adapter.start(activationEnvelope(), {
          registerPrepared: async () => undefined,
        }),
        (error: unknown) => {
          assert.equal(String(error).includes("CANARY-"), false);
          return true;
        },
      );
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("direct and supervised launch paths share one environment policy owner", () => {
  const source = readFileSync(adapterSourcePath, "utf8");
  assert.equal(
    (source.match(/#createActivationProcessEnvironment\(/gu) ?? []).length,
    3,
    "one definition plus the direct and supervised call sites",
  );
  assert.equal(
    (source.match(/\bspawn\(/gu) ?? []).length,
    2,
    "only the direct and supervised launch paths spawn Provider processes",
  );
  // Every spawn option object must take its environment from the shared
  // policy; the supervised path may add only its own control variables.
  const spawnEnvironments = [
    ...source.matchAll(/^\s+env: (?<value>[\s\S]{0,220})/gmu),
  ]
    .map((match) => match.groups?.value ?? "")
    .filter((value) => !value.startsWith("Readonly<"));
  assert.equal(spawnEnvironments.length, 2);
  for (const value of spawnEnvironments) {
    assert.equal(
      value.includes("#createActivationProcessEnvironment("),
      true,
      value.slice(0, 80),
    );
  }
  assert.deepEqual(
    [...source.matchAll(/RAH_PROCESS_SUPERVISOR_[A-Z]+/gu)].map(
      (match) => match[0],
    ),
    ["RAH_PROCESS_SUPERVISOR_CONFIG", "RAH_PROCESS_SUPERVISOR_TOKEN"],
    "the supervised path adds only its own control variables",
  );
  assert.equal(
    (source.match(/process\.env/gu) ?? []).length,
    2,
    "the adapter reads the host environment only for PATH probing and the policy",
  );
});
