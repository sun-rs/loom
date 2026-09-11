import assert from "node:assert/strict";
import test from "node:test";
import { quarantineAgentExecutionWorkspaceReset } from "../src/agent-execution-workspace-reset.ts";

function quarantine(name: string, calls: string[], rollbackError?: Error) {
  return {
    kind: "quarantined" as const,
    quarantinePath: `/${name}/quarantine`,
    commit: () => {
      calls.push(`${name}:commit`);
    },
    rollback: async () => {
      calls.push(`${name}:rollback`);
      if (rollbackError) throw rollbackError;
    },
  };
}

test("execution preparation failure restores memory and preserves the original error", async () => {
  const calls: string[] = [];
  const failure = new Error("execution prepare failed");
  await assert.rejects(
    quarantineAgentExecutionWorkspaceReset({
      quarantineMemory: async () => {
        calls.push("memory:prepare");
        return quarantine("memory", calls);
      },
      quarantineExecution: async () => {
        calls.push("execution:prepare");
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.deepEqual(calls, [
    "memory:prepare",
    "execution:prepare",
    "memory:rollback",
  ]);
});

test("preparation and restoration errors are both retained", async () => {
  const calls: string[] = [];
  const failure = new Error("execution prepare failed");
  const restoreFailure = new Error("memory restoration failed");
  await assert.rejects(
    quarantineAgentExecutionWorkspaceReset({
      quarantineMemory: async () => quarantine("memory", calls, restoreFailure),
      quarantineExecution: async () => {
        throw failure;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure, restoreFailure]);
      return true;
    },
  );
});

test("commit retains memory metadata and commits each prepared workspace once", async () => {
  const calls: string[] = [];
  const prepared = await quarantineAgentExecutionWorkspaceReset({
    quarantineMemory: async () => {
      calls.push("memory:prepare");
      return quarantine("memory", calls);
    },
    quarantineExecution: async () => {
      calls.push("execution:prepare");
      return quarantine("execution", calls);
    },
  });
  assert.equal(prepared.kind, "quarantined");
  assert.equal(prepared.quarantinePath, "/memory/quarantine");
  prepared.commit();
  prepared.commit();
  await prepared.rollback();
  assert.deepEqual(calls, [
    "memory:prepare",
    "execution:prepare",
    "memory:commit",
    "execution:commit",
  ]);
});

test("rollback restores in reverse order, including repeated concurrent calls only once", async () => {
  const calls: string[] = [];
  const prepared = await quarantineAgentExecutionWorkspaceReset({
    quarantineMemory: async () => quarantine("memory", calls),
    quarantineExecution: async () => quarantine("execution", calls),
  });
  await Promise.all([prepared.rollback(), prepared.rollback()]);
  prepared.commit();
  await prepared.rollback();
  assert.deepEqual(calls, ["execution:rollback", "memory:rollback"]);
});

test("rollback attempts both workspaces and retains every restoration failure", async () => {
  const calls: string[] = [];
  const executionFailure = new Error("execution restoration failed");
  const memoryFailure = new Error("memory restoration failed");
  for (const failingMemory of [undefined, memoryFailure]) {
    calls.length = 0;
    const prepared = await quarantineAgentExecutionWorkspaceReset({
      quarantineMemory: async () => quarantine("memory", calls, failingMemory),
      quarantineExecution: async () =>
        quarantine("execution", calls, executionFailure),
    });
    await assert.rejects(prepared.rollback(), (error) => {
      if (failingMemory) {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [executionFailure, failingMemory]);
      } else assert.equal(error, executionFailure);
      return true;
    });
    await assert.rejects(prepared.rollback());
    assert.throws(() => prepared.commit(), /rollback started/);
    assert.deepEqual(calls, [
      "execution:rollback",
      "memory:rollback",
      "execution:rollback",
      ...(failingMemory ? ["memory:rollback"] : []),
    ]);
  }
});

test("legacy reset only operates on memory and never requires an execution directory", async () => {
  const calls: string[] = [];
  const prepared = await quarantineAgentExecutionWorkspaceReset({
    quarantineMemory: async () => quarantine("memory", calls),
    quarantineExecution: async () => undefined,
  });
  await prepared.rollback();
  await prepared.rollback();
  assert.deepEqual(calls, ["memory:rollback"]);
});

test("failed rollback remains retryable without repeating already restored memory", async () => {
  const calls: string[] = [];
  const failure = new Error("transient execution rollback failure");
  let attempts = 0;
  const prepared = await quarantineAgentExecutionWorkspaceReset({
    quarantineMemory: async () => quarantine("memory", calls),
    quarantineExecution: async () => ({
      commit: () => {
        calls.push("execution:commit");
      },
      rollback: async () => {
        calls.push("execution:rollback");
        if (++attempts === 1) throw failure;
      },
    }),
  });
  await assert.rejects(prepared.rollback(), (error) => error === failure);
  assert.deepEqual(calls, ["execution:rollback", "memory:rollback"]);
  await prepared.rollback();
  assert.deepEqual(calls, [
    "execution:rollback",
    "memory:rollback",
    "execution:rollback",
  ]);
  await prepared.rollback();
  prepared.commit();
  assert.equal(calls.length, 3);
});
