import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProviderSessionStore } from "../src/provider-session-store.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-fork-binding-"));
  const store = new ProviderSessionStore({ rootDirectory: root });
  const source = {
    participantId: "parent",
    provider: "fake/v1",
    runtimeProfileRevisionId: "profile",
    workspaceMountRevisionId: "mount",
  };
  const target = { ...source, participantId: "child" };
  const input = {
    operationId: "human-fork-1",
    source,
    sourceGeneration: 2,
    target,
  };
  await store.record(source, "native-parent", {
    instance: true,
    instanceGeneration: 2,
    standingProtocolVersion: "old-identity-protocol",
    systemMemorySha256: "a".repeat(64),
  });
  return {
    root,
    store,
    source,
    target,
    input,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("fork binds a new native session, leaves source intact and does not inherit prompt/memory delivery receipts", async () => {
  const f = await fixture();
  try {
    const before = await f.store.load(f.source, {
      instance: true,
      instanceGeneration: 2,
    });
    const created = await f.store.forkInstance(f.input, async (source) => {
      assert.equal(source.providerSessionId, "native-parent");
      return "native-child";
    });
    assert.equal(created.providerSessionId, "native-child");
    assert.equal(created.standingProtocolVersion, undefined);
    assert.equal(created.systemMemorySha256, undefined);
    assert.deepEqual(
      await f.store.load(f.source, { instance: true, instanceGeneration: 2 }),
      before,
    );
    assert.deepEqual(await f.store.load(f.target, { instance: true }), created);
    assert.equal(
      await f.store.load(f.source, { instance: true, instanceGeneration: 3 }),
      null,
    );
  } finally {
    await f.close();
  }
});

test("durable replay after Host reconstruction never calls native fork twice", async () => {
  const f = await fixture();
  try {
    const first = await f.store.forkInstance(
      f.input,
      async () => "native-child",
    );
    const restarted = new ProviderSessionStore({ rootDirectory: f.root });
    assert.deepEqual(
      await restarted.forkInstance(f.input, async () => {
        throw Error("must not rerun");
      }),
      first,
    );
    await assert.rejects(
      restarted.forkInstance(
        { ...f.input, operationId: "other" },
        async () => "other-native",
      ),
      /conflict/i,
    );
  } finally {
    await f.close();
  }
});

test("an unknown native result remains fenced across Host restart", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    await assert.rejects(
      f.store.forkInstance(f.input, async () => {
        calls++;
        throw Error("connection lost after native copy");
      }),
      /FORK_UNCERTAIN/,
    );
    await assert.rejects(
      new ProviderSessionStore({ rootDirectory: f.root }).forkInstance(
        f.input,
        async () => {
          calls++;
          return "duplicate";
        },
      ),
      /FORK_UNCERTAIN/,
    );
    assert.equal(calls, 1);
    assert.equal(await f.store.load(f.target, { instance: true }), null);
  } finally {
    await f.close();
  }
});

test("concurrent duplicate requests invoke the native operation at most once", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const startedWait = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = f.store.forkInstance(f.input, async () => {
      started();
      await wait;
      return "native-child";
    });
    await startedWait;
    try {
      await assert.rejects(
        f.store.forkInstance(f.input, async () => {
          throw Error("duplicate native call");
        }),
        /FORK_UNCERTAIN/,
      );
    } finally {
      release();
    }
    await pending;
  } finally {
    await f.close();
  }
});

test("missing source, same principal, provider mismatch and existing target fail before native execution", async () => {
  const f = await fixture();
  try {
    const never = async () => {
      throw Error("native must not run");
    };
    await assert.rejects(
      f.store.forkInstance({ ...f.input, sourceGeneration: 3 }, never),
      /CONTINUITY_REQUIRED/,
    );
    await assert.rejects(
      f.store.forkInstance({ ...f.input, target: f.source }, never),
      /distinct/i,
    );
    await assert.rejects(
      f.store.forkInstance(
        { ...f.input, target: { ...f.target, provider: "different/v1" } },
        never,
      ),
      /provider/i,
    );
    await f.store.record(f.target, "already-bound", { instance: true });
    await assert.rejects(f.store.forkInstance(f.input, never), /bound/i);
  } finally {
    await f.close();
  }
});

test("a provider returning the source session is rejected and never binds the child", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.store.forkInstance(f.input, async () => "native-parent"),
      /FORK_UNCERTAIN/,
    );
    assert.equal(await f.store.load(f.target, { instance: true }), null);
  } finally {
    await f.close();
  }
});

test("a known native result survives a binding-write failure without another native copy", async () => {
  const f = await fixture();
  try {
    class InterruptedBindingStore extends ProviderSessionStore {
      override async record(
        ...args: Parameters<ProviderSessionStore["record"]>
      ) {
        if (args[0].participantId === "child")
          throw new Error("simulated binding write failure");
        return super.record(...args);
      }
    }
    await assert.rejects(
      new InterruptedBindingStore({ rootDirectory: f.root }).forkInstance(
        f.input,
        async () => "native-child",
      ),
      /binding write failure/,
    );
    assert.equal(await f.store.load(f.target, { instance: true }), null);
    const recovered = await f.store.forkInstance(f.input, async () => {
      throw Error("must not rerun native fork");
    });
    assert.equal(recovered.providerSessionId, "native-child");
  } finally {
    await f.close();
  }
});

test("a torn operation receipt fails closed rather than treating it as a fresh operation", async () => {
  const f = await fixture();
  try {
    await f.store.forkInstance(f.input, async () => "native-child");
    const { readdir, writeFile } = await import("node:fs/promises");
    const directory = join(f.root, "fork-receipts");
    const [file] = await readdir(directory);
    await writeFile(join(directory, file!), '{"version":');
    await assert.rejects(
      f.store.forkInstance(f.input, async () => {
        throw Error("must not rerun native fork");
      }),
      /FORK_UNCERTAIN/,
    );
  } finally {
    await f.close();
  }
});
