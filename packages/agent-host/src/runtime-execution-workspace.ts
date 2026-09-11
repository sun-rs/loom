import type { RuntimeRecoveryDescriptor } from "@rah-os/protocol";
import type {
  RunHandle,
  RuntimeAdapter,
  RuntimeStartLifecycle,
} from "./runtime.ts";

/** Freezes verified Placement provenance before the existing prepared-run ledger write. */
export function withRuntimeExecutionWorkspace(
  runtime: RuntimeAdapter,
  workspace: NonNullable<RuntimeRecoveryDescriptor["executionWorkspace"]>,
): RuntimeAdapter {
  const frozenWorkspace = Object.freeze({ ...workspace });
  const enrich = (run: RunHandle): RunHandle => {
    if (run.recoveryDescriptor === undefined)
      throw new Error(
        "Private execution workspace requires a recovery descriptor",
      );
    return {
      ...run,
      recoveryDescriptor: {
        ...run.recoveryDescriptor,
        executionWorkspace: frozenWorkspace,
      },
    };
  };
  return new Proxy(runtime, {
    get(target, property) {
      if (property === "start") {
        const start: RuntimeAdapter["start"] = async (input, lifecycle) => {
          if (input.participantId !== frozenWorkspace.participantId)
            throw new Error(
              "Execution workspace participant does not match activation",
            );
          let prepared: RunHandle | undefined;
          const forwarded = new Proxy(lifecycle, {
            get(source, key) {
              if (key === "registerPrepared") {
                return async (run: RunHandle) => {
                  const candidate = enrich(run);
                  await source.registerPrepared(candidate);
                  prepared = candidate;
                };
              }
              const value = Reflect.get(source, key, source);
              return typeof value === "function" ? value.bind(source) : value;
            },
          }) satisfies RuntimeStartLifecycle;
          const run = await target.start(input, forwarded);
          if (prepared === undefined || prepared.runId !== run.runId) {
            const failure = new Error(
              "Private execution workspace lacks a persisted prepared receipt",
            );
            try {
              await target.cancel(run);
            } catch (error) {
              throw new AggregateError(
                [failure, error],
                "Unregistered private runtime cancellation failed",
              );
            }
            throw failure;
          }
          return enrich(run);
        };
        return start;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
