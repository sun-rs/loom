export type WorkspaceResetQuarantine = Readonly<{
  commit(): void;
  rollback(): Promise<void>;
}>;

/**
 * Composes already-authorized workspace quarantines under the caller's existing
 * Agent reset fence. No directory selection, deletion or memory ownership lives
 * here. The memory receipt remains the public reset receipt.
 */
export async function quarantineAgentExecutionWorkspaceReset<
  T extends WorkspaceResetQuarantine,
>(input: {
  quarantineMemory: () => Promise<T>;
  quarantineExecution: () => Promise<WorkspaceResetQuarantine | undefined>;
}): Promise<T> {
  const memory = await input.quarantineMemory();
  let execution: WorkspaceResetQuarantine | undefined;
  try {
    execution = await input.quarantineExecution();
  } catch (error) {
    try {
      await memory.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Execution workspace preparation and memory restoration failed",
      );
    }
    throw error;
  }
  const prepared = execution === undefined ? [memory] : [memory, execution];
  let active = true;
  let rollbackStarted = false;
  let rollbackInFlight: Promise<void> | undefined;
  const unrestored = new Set(prepared);
  return Object.freeze({
    ...memory,
    commit: () => {
      if (!active) return;
      if (rollbackStarted)
        throw new Error(
          "Cannot commit a workspace reset after rollback started",
        );
      active = false;
      const errors: unknown[] = [];
      for (const workspace of prepared) {
        try {
          workspace.commit();
        } catch (error) {
          errors.push(error);
        }
      }
      throwFailures(errors, "Workspace quarantine commit failed");
    },
    rollback: async () => {
      if (!active) return;
      if (rollbackInFlight) return await rollbackInFlight;
      rollbackStarted = true;
      rollbackInFlight = (async () => {
        const errors: unknown[] = [];
        for (const workspace of [...prepared].reverse()) {
          if (!unrestored.has(workspace)) continue;
          try {
            await workspace.rollback();
            unrestored.delete(workspace);
          } catch (error) {
            errors.push(error);
          }
        }
        if (unrestored.size === 0) active = false;
        throwFailures(errors, "Workspace quarantine restoration failed");
      })();
      try {
        await rollbackInFlight;
      } finally {
        rollbackInFlight = undefined;
      }
    },
  });
}

function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
