import assert from "node:assert/strict";
import test from "node:test";
import { withRuntimeExecutionWorkspace } from "../src/runtime-execution-workspace.ts";
import { FakeRuntimeAdapter } from "../src/fake-runtime.ts";
import type {
  ActivationEnvelope,
  RunHandle,
  RuntimeStartLifecycle,
} from "../src/runtime.ts";

const workspace = {
  participantId: "agent-a",
  workspaceDefinitionId: "workspace-a",
  workspaceMountRevisionId: "mount-a",
  workspaceMountDigest: `sha256:${"a".repeat(64)}`,
};
const activation: ActivationEnvelope = {
  activationId: "activation-a",
  fromSeq: 1,
  toSeq: 2,
  participantId: "agent-a",
  reason: "manual",
  roomId: "room-a",
  consumerId: "consumer-a",
  hostId: "host-a",
  runAttemptId: "attempt-a",
};

test("prepared and returned recovery receipts carry the same frozen workspace provenance", async () => {
  const source = { ...workspace };
  const adapter = new FakeRuntimeAdapter();
  const runtime = withRuntimeExecutionWorkspace(adapter, source);
  source.workspaceMountRevisionId = "changed-after-wrap";
  let registered: RunHandle | undefined;
  const run = await runtime.start(activation, {
    registerPrepared: async (candidate) => {
      registered = candidate;
    },
  });
  assert.deepEqual(
    registered?.recoveryDescriptor?.executionWorkspace,
    workspace,
  );
  assert.deepEqual(run.recoveryDescriptor?.executionWorkspace, workspace);
  assert.ok(Object.isFrozen(run.recoveryDescriptor?.executionWorkspace));
  assert.equal(run.runId, registered?.runId);
  assert.equal(run.recoveryDescriptor?.driver, "fake-runtime");
});

test("foreign participants are rejected before the runtime starts", async () => {
  const adapter = new FakeRuntimeAdapter();
  const runtime = withRuntimeExecutionWorkspace(adapter, workspace);
  await assert.rejects(
    runtime.start(
      { ...activation, participantId: "agent-b" },
      {
        registerPrepared: async () => {},
      },
    ),
    /participant/,
  );
  assert.equal(adapter.starts.length, 0);
});

test("failed persistence cannot become a successful private launch", async () => {
  const runtime = withRuntimeExecutionWorkspace(
    new FakeRuntimeAdapter(),
    workspace,
  );
  const failure = new Error("ledger unavailable");
  await assert.rejects(
    runtime.start(activation, {
      registerPrepared: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
});

test("adapters without descriptors or prepared receipts cannot claim recoverable private launch", async () => {
  for (const register of [true, false]) {
    class MissingReceiptRuntime extends FakeRuntimeAdapter {
      override async start(
        _input: ActivationEnvelope,
        lifecycle: RuntimeStartLifecycle,
      ) {
        const run = { runId: "no-recovery" };
        if (register) await lifecycle.registerPrepared(run);
        return run;
      }
    }
    const runtime = withRuntimeExecutionWorkspace(
      new MissingReceiptRuntime(),
      workspace,
    );
    let persisted = false;
    await assert.rejects(
      runtime.start(activation, {
        registerPrepared: async () => {
          persisted = true;
        },
      }),
      /recovery|prepared/,
    );
    assert.equal(persisted, false);
  }
});

test("proxy preserves optional runtime methods and their private receiver", async () => {
  class BusyRuntime extends FakeRuntimeAdapter {
    #notices = 0;
    readonly busyInputMode = "direct" as const;
    readonly busyInputSupported = true;
    async notifyBusy() {
      return ++this.#notices === 1;
    }
  }
  const runtime = withRuntimeExecutionWorkspace(
    new BusyRuntime({ onRecover: () => ({ code: 9 }) }),
    workspace,
  );
  assert.equal(runtime.busyInputMode, "direct");
  assert.equal(runtime.busyInputSupported, true);
  assert.deepEqual(await runtime.probe(), { available: true });
  const run = await runtime.start(activation, {
    registerPrepared: async () => {},
  });
  assert.equal(
    await runtime.notifyBusy?.(run, { fingerprint: "notice", text: "hello" }),
    true,
  );
  assert.deepEqual(await runtime.reap(run), { code: 0 });
  assert.equal(
    (
      await runtime.recover?.({
        recoveryDescriptor: run.recoveryDescriptor!,
        runAttemptId: "attempt-a",
        runtimeRunId: run.runId,
      })
    )?.code,
    9,
  );
  assert.equal(
    withRuntimeExecutionWorkspace(new FakeRuntimeAdapter(), workspace)
      .notifyBusy,
    undefined,
  );
});

test("registry recovery selects cwd from frozen descriptor and keeps legacy cwd without resolver", async () => {
  const {
    createRegistryBackedRuntimeRecovery,
    createRegistryBackedRuntimeRecoveryFromRegistries,
  } = await import("../src/runtime-profile-recovery.ts");
  const adapter = new FakeRuntimeAdapter();
  const descriptor = {
    driver: "fake-runtime",
    metadata: {},
    recoveryKey: "recovery-a",
    runtimeProfileRevisionId: "revision-a",
    runtimeProfileDigest: "digest-a",
    recoveryImplementationVersion: "1",
    executionWorkspace: workspace,
  };
  const observed: string[] = [];
  const implementations = {
    recoveryDrivers: () => ["fake-runtime"],
    recoveryDriverImplementationVersion: () => "1",
    createRecoveryRuntime: (
      _revision: unknown,
      _driver: string,
      options: { cwd: string },
    ) => {
      observed.push(options.cwd);
      return adapter;
    },
  } as unknown as import("../src/runtime-implementation-registry.ts").RuntimeImplementationRegistry;
  const registry = {
    getRevision: () => ({ contentDigest: "digest-a" }),
  } as unknown as import("../src/runtime-profile-registry.ts").RuntimeProfileRegistry;
  const common = {
    cwd: "/legacy",
    supervisorDirectory: "/supervisor",
    implementations,
  };
  let calls = 0;
  const resolveCwd = (
    received: import("@rah-os/protocol").RuntimeRecoveryDescriptor,
  ) => {
    calls++;
    assert.equal(received, descriptor);
    return "/frozen-agent-a";
  };
  assert.equal(
    createRegistryBackedRuntimeRecovery({
      ...common,
      registry,
      resolveCwd,
    }).resolve(descriptor),
    adapter,
  );
  assert.equal(
    createRegistryBackedRuntimeRecoveryFromRegistries({
      ...common,
      registries: [registry],
      resolveCwd,
    }).resolve(descriptor),
    adapter,
  );
  assert.equal(
    createRegistryBackedRuntimeRecovery({ ...common, registry }).resolve(
      descriptor,
    ),
    adapter,
  );
  assert.deepEqual(observed, ["/frozen-agent-a", "/frozen-agent-a", "/legacy"]);
  assert.equal(calls, 2);
});
