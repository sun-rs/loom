import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";

type Previous = { providerSessionId: string; systemMemorySha256?: string };
/** Native transport metadata only, never a model-read or Kernel ACK receipt. */
export class ProviderSystemMemory {
  readonly #runs = new Map<
    string,
    { current: string | undefined; previous: Previous | null }
  >();

  prepare(
    runId: string,
    lease: ActivationEnvironmentLease,
    previous: Previous | null,
  ): ActivationEnvironmentLease {
    if (this.#runs.size >= 64 && !this.#runs.has(runId))
      this.#runs.delete(this.#runs.keys().next().value!);
    const current = lease.env.RAH_AGENT_MEMORY_SYSTEM_SHA256;
    this.#runs.set(runId, { current, previous });
    if (previous === null || current === undefined) return lease;
    // Both real CLIs retained their original system memory on resume. Never
    // label a newly assembled prompt as applied to an existing native session.
    const env = { ...lease.env };
    delete env.RAH_AGENT_MEMORY_SYSTEM_SHA256;
    if (previous.systemMemorySha256 !== undefined)
      env.RAH_AGENT_MEMORY_SYSTEM_SHA256 = previous.systemMemorySha256;
    return { ...lease, env };
  }

  evidence(runId: string, sessionId: string): string | undefined {
    const run = this.#runs.get(runId);
    return run?.previous?.providerSessionId === sessionId
      ? run.previous.systemMemorySha256
      : run?.current;
  }
}
