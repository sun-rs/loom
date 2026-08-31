import { AgentHost, type AgentHostOptions } from "./agent-host.ts";
import { ComputerResidentService } from "./computer-resident-service.ts";
import {
  createRemoteComputerAgentHostControlPort,
  requireRemoteComputerAgentHostIdentity,
} from "./remote-computer-agent-host-control.ts";

const MAX_CAPACITY = 128;

export type RemoteComputerAgentHostOptions = Omit<
  AgentHostOptions,
  | "control"
  | "host"
  | "kernel"
  | "manageHostLifecycle"
  | "runtimeRecoveryDrivers"
  | "runtimeRecoveryResolver"
> & {
  placementRuntimeResolver: NonNullable<
    AgentHostOptions["placementRuntimeResolver"]
  >;
};

export type RemoteComputerAgentHostServiceOptions = {
  agentHost: RemoteComputerAgentHostOptions;
  capacity: number;
  resident: ComputerResidentService;
};

export type RemoteComputerAgentHostServiceSnapshot = {
  hostId?: string;
  hostInstanceId?: string;
  lastError?: string;
  state: "idle" | "starting" | "running" | "draining" | "stopped";
};

/**
 * Composes one authenticated Computer connection with its bounded AgentHost
 * workers. Connection/Offer reconciliation starts first; shutdown drains every
 * runtime while the control session is still usable, then reports offline.
 */
export class RemoteComputerAgentHostService {
  readonly #agentHost: RemoteComputerAgentHostOptions;
  readonly #capacity: number;
  readonly #resident: ComputerResidentService;
  #snapshot: RemoteComputerAgentHostServiceSnapshot = { state: "idle" };

  constructor(options: RemoteComputerAgentHostServiceOptions) {
    if (
      !Number.isSafeInteger(options.capacity) ||
      options.capacity <= 0 ||
      options.capacity > MAX_CAPACITY
    ) {
      throw new Error(
        `capacity must be a positive safe integer at most ${String(MAX_CAPACITY)}`,
      );
    }
    this.#agentHost = options.agentHost;
    this.#capacity = options.capacity;
    this.#resident = options.resident;
  }

  snapshot(): RemoteComputerAgentHostServiceSnapshot {
    return { ...this.#snapshot };
  }

  async run(input: { signal: AbortSignal }): Promise<void> {
    if (this.#snapshot.state !== "idle") {
      throw new Error("RemoteComputerAgentHostService can only run once");
    }
    this.#snapshot = { state: "starting" };
    if (input.signal.aborted) {
      await this.#resident.stop();
      this.#snapshot = { state: "stopped" };
      return;
    }

    const workerController = new AbortController();
    const residentController = new AbortController();
    const beginDrain = () => {
      if (this.#snapshot.state === "running") {
        this.#snapshot = { ...this.#snapshot, state: "draining" };
      }
      workerController.abort(input.signal.reason);
    };
    input.signal.addEventListener("abort", beginDrain, { once: true });
    const failures: unknown[] = [];
    try {
      await this.#resident.reconcileOnce();
      const identity = requireRemoteComputerAgentHostIdentity(this.#resident);
      const control = createRemoteComputerAgentHostControlPort(this.#resident);
      const workers = Array.from(
        { length: this.#capacity },
        () =>
          new AgentHost({
            ...this.#agentHost,
            control,
            host: identity,
            manageHostLifecycle: false,
            runtimeRecoveryDrivers: [],
          }),
      );
      this.#snapshot = {
        hostId: identity.hostId,
        hostInstanceId: identity.instanceId,
        state: input.signal.aborted ? "draining" : "running",
      };
      if (input.signal.aborted) beginDrain();

      let residentStoppedUnexpectedly = false;
      const residentOutcome = this.#resident
        .run({ signal: residentController.signal })
        .then(
          () => ({ status: "fulfilled" as const }),
          (reason: unknown) => ({ reason, status: "rejected" as const }),
        );
      void residentOutcome.then((outcome) => {
        if (!residentController.signal.aborted) {
          residentStoppedUnexpectedly = outcome.status === "fulfilled";
          workerController.abort(
            outcome.status === "rejected"
              ? outcome.reason
              : "Computer resident stopped unexpectedly",
          );
        }
      });

      const workerOutcomes = await Promise.allSettled(
        workers.map(async (worker) => {
          try {
            await worker.run({ signal: workerController.signal });
          } catch (error) {
            workerController.abort(error);
            throw error;
          }
        }),
      );
      residentController.abort("AgentHost workers drained");
      const settledResident = await residentOutcome;
      for (const outcome of workerOutcomes) {
        if (outcome.status === "rejected") failures.push(outcome.reason);
      }
      if (settledResident.status === "rejected") {
        failures.push(settledResident.reason);
      } else if (residentStoppedUnexpectedly) {
        failures.push(new Error("Computer resident stopped unexpectedly"));
      }
    } catch (error) {
      failures.push(error);
    } finally {
      input.signal.removeEventListener("abort", beginDrain);
      workerController.abort("Remote Computer service stopped");
      residentController.abort("Remote Computer service stopped");
      const identity = {
        hostId: this.#snapshot.hostId,
        hostInstanceId: this.#snapshot.hostInstanceId,
      };
      const stopped = await this.#resident.stop();
      const hostId = stopped.hostId ?? identity.hostId;
      const hostInstanceId = stopped.hostInstanceId ?? identity.hostInstanceId;
      const lastError = failures.length === 0 ? undefined : errorText(failures);
      this.#snapshot = {
        ...(hostId === undefined ? {} : { hostId }),
        ...(hostInstanceId === undefined ? {} : { hostInstanceId }),
        ...(lastError === undefined ? {} : { lastError }),
        state: "stopped",
      };
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "Remote Computer AgentHost service failed",
      );
    }
  }
}

function errorText(errors: readonly unknown[]): string {
  return errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .join("; ");
}
