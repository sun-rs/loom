import type { ComputerManagedAttachmentServicePort } from "./computer-attachment-manager.ts";
import {
  ComputerResidentService,
  ComputerResidentServiceTerminalError,
  type ComputerResidentServiceSnapshot,
} from "./computer-resident-service.ts";
import {
  RemoteComputerAgentHostService,
  type RemoteComputerAgentHostServiceOptions,
} from "./remote-computer-agent-host-service.ts";

export type RemoteComputerManagedAttachmentServiceOptions = Omit<
  RemoteComputerAgentHostServiceOptions,
  "resident"
> & {
  resident: ComputerResidentService;
};

/**
 * Adapts the continuous remote AgentHost composition to the attachment
 * catalog manager's reconcile/stop lifecycle. A fatal composition error parks
 * only this attachment; the catalog manager continues serving its peers.
 */
export class RemoteComputerManagedAttachmentService implements ComputerManagedAttachmentServicePort {
  readonly #composition: RemoteComputerAgentHostService;
  readonly #resident: ComputerResidentService;
  #controller: AbortController | undefined;
  #outcome:
    Readonly<{ error?: unknown; state: "completed" | "failed" }> | undefined;
  #run: Promise<void> | undefined;
  #stopped = false;

  constructor(options: RemoteComputerManagedAttachmentServiceOptions) {
    this.#resident = options.resident;
    this.#composition = new RemoteComputerAgentHostService(options);
  }

  snapshot(): ComputerResidentServiceSnapshot {
    return this.#resident.snapshot();
  }

  async reconcileOnce(): Promise<ComputerResidentServiceSnapshot> {
    if (this.#stopped) return this.snapshot();
    this.#throwTerminalOutcome();
    if (this.#run === undefined) {
      await this.#resident.reconcileOnce();
      const controller = new AbortController();
      const run = this.#composition.run({ signal: controller.signal });
      this.#controller = controller;
      this.#run = run;
      void run.then(
        () => {
          this.#outcome = { state: "completed" };
        },
        (error: unknown) => {
          this.#outcome = { error, state: "failed" };
        },
      );
      await Promise.resolve();
      this.#throwTerminalOutcome();
    }
    return this.snapshot();
  }

  async stop(): Promise<ComputerResidentServiceSnapshot> {
    if (this.#stopped) return this.snapshot();
    this.#stopped = true;
    this.#controller?.abort("Computer attachment retired");
    try {
      await this.#run;
    } catch {
      // The manager records the already classified terminal outcome.
    }
    await this.#resident.stop();
    return this.snapshot();
  }

  #throwTerminalOutcome(): void {
    const outcome = this.#outcome;
    if (outcome === undefined || this.#stopped) return;
    if (outcome.error instanceof ComputerResidentServiceTerminalError) {
      throw outcome.error;
    }
    throw new ComputerResidentServiceTerminalError(
      "configuration",
      outcome.state === "completed"
        ? "Remote Computer attachment service stopped unexpectedly"
        : "Remote Computer attachment service failed",
    );
  }
}
