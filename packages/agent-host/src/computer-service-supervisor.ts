import type { Slot } from "@rah-os/k-carrier";

export type SupervisedComputerServiceExit = Readonly<{
  code: number | null;
  signal: string | null;
}>;

export type SupervisedComputerServiceProcess = Readonly<{
  exited: Promise<SupervisedComputerServiceExit>;
  processId: number;
  requestStop(): Promise<void>;
  slot: Slot;
}>;

export type ComputerServiceSupervisorSnapshot =
  | Readonly<{ kind: "new" | "closed" | "handoff_waiting" }>
  | Readonly<{
      kind: "running";
      processId: number;
      slot: Slot;
    }>;

export type ComputerServiceSupervisorCompletion =
  | Readonly<{ kind: "closed" }>
  | Readonly<{
      kind: "fatal";
      reason: "child_exited" | "handoff_timed_out" | "launch_failed";
    }>;

export type ComputerServiceSupervisorOptions = Readonly<{
  handoffTimeoutMs?: number;
  launch(slot: Slot): Promise<SupervisedComputerServiceProcess>;
}>;

export type ComputerServiceSupervisorControlPort = Readonly<{
  startForHandoff(slot: Slot): Promise<ComputerServiceSupervisorSnapshot>;
  stopForHandoff(input: {
    expectedProcessId: number;
  }): Promise<ComputerServiceSupervisorSnapshot>;
}>;

type InternalState =
  | "closed"
  | "closing"
  | "handoff_waiting"
  | "launching"
  | "new"
  | "running"
  | "stopping";

/**
 * The launchd-owned carrier's sole in-memory child owner. K remains the slot
 * and transaction authority; this class only prevents launchd, a coordinator,
 * and an orphaned child from independently restarting different slots.
 *
 * A planned stop opens a bounded handoff window. If no replacement is started
 * in time, completion becomes fatal so the carrier process exits and launchd
 * restarts a fresh carrier, which starts stable and lets K recovery decide.
 */
export class ComputerServiceSupervisor {
  readonly completion: Promise<ComputerServiceSupervisorCompletion>;
  readonly #handoffTimeoutMs: number;
  readonly #launch: ComputerServiceSupervisorOptions["launch"];
  #complete!: (value: ComputerServiceSupervisorCompletion) => void;
  #current: SupervisedComputerServiceProcess | undefined;
  #handoffTimer: ReturnType<typeof setTimeout> | undefined;
  #state: InternalState = "new";
  #terminal = false;

  constructor(options: ComputerServiceSupervisorOptions) {
    this.#handoffTimeoutMs = positiveInteger(
      options.handoffTimeoutMs ?? 30_000,
      "handoffTimeoutMs",
    );
    this.#launch = options.launch;
    this.completion = new Promise((resolve) => {
      this.#complete = resolve;
    });
  }

  snapshot(): ComputerServiceSupervisorSnapshot {
    if (this.#state === "new") return Object.freeze({ kind: "new" });
    if (this.#state === "closed" || this.#state === "closing") {
      return Object.freeze({ kind: "closed" });
    }
    if (this.#state === "handoff_waiting" || this.#state === "stopping") {
      return Object.freeze({ kind: "handoff_waiting" });
    }
    const current = this.#current;
    if (current === undefined) {
      return Object.freeze({ kind: "handoff_waiting" });
    }
    return Object.freeze({
      kind: "running",
      processId: current.processId,
      slot: current.slot,
    });
  }

  async start(): Promise<ComputerServiceSupervisorSnapshot> {
    if (this.#state !== "new") {
      throw new Error("Computer supervisor has already started");
    }
    await this.#launchSlot("stable");
    return this.snapshot();
  }

  async stopForHandoff(input: {
    expectedProcessId: number;
  }): Promise<ComputerServiceSupervisorSnapshot> {
    const expectedProcessId = positiveInteger(
      input.expectedProcessId,
      "expectedProcessId",
    );
    if (this.#state !== "running" || this.#current === undefined) {
      throw new Error("Computer supervisor has no running service to stop");
    }
    const incumbent = this.#current;
    if (incumbent.processId !== expectedProcessId) {
      throw new Error(
        "Computer supervisor does not own the expected service process",
      );
    }
    this.#state = "stopping";
    try {
      await incumbent.requestStop();
      await incumbent.exited;
    } catch (error) {
      this.#state = "running";
      throw error;
    }
    if (this.#current !== incumbent) {
      throw new Error("Computer supervisor child identity changed during stop");
    }
    this.#current = undefined;
    this.#state = "handoff_waiting";
    this.#scheduleHandoffDeadline();
    return this.snapshot();
  }

  async startForHandoff(
    slot: Slot,
  ): Promise<ComputerServiceSupervisorSnapshot> {
    if (this.#state !== "handoff_waiting" || this.#current !== undefined) {
      throw new Error("Computer supervisor has not stopped the incumbent");
    }
    if (slot !== "stable" && slot !== "experiment") {
      throw new Error("Computer supervisor slot is invalid");
    }
    await this.#launchSlot(slot);
    this.#clearHandoffDeadline();
    return this.snapshot();
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closing";
    this.#clearHandoffDeadline();
    const current = this.#current;
    this.#current = undefined;
    if (current !== undefined) {
      try {
        await current.requestStop();
        await current.exited;
      } catch {
        // Closing is best effort; the production process lease closes when
        // this carrier exits and is the final orphan fence.
      }
    }
    this.#state = "closed";
    this.#finish({ kind: "closed" });
  }

  async #launchSlot(slot: Slot): Promise<void> {
    this.#state = "launching";
    let launched: SupervisedComputerServiceProcess;
    try {
      launched = normalizeProcess(await this.#launch(slot), slot);
      if (this.#state !== "launching" || this.#terminal) {
        try {
          await launched.requestStop();
          await launched.exited;
        } catch {
          // The carrier process exits after a fatal completion and closes the
          // FD lease. This best-effort stop prevents a late launch from living
          // until that final process fence when the launcher still responds.
        }
        throw new Error(
          "Computer supervisor launch completed after the handoff deadline",
        );
      }
    } catch (error) {
      if (!this.#terminal) this.#fatal("launch_failed");
      throw error;
    }
    this.#current = launched;
    this.#state = "running";
    void launched.exited.then(
      (exit) => this.#observeExit(launched, exit),
      () => this.#observeExit(launched, { code: null, signal: null }),
    );
  }

  #observeExit(
    process: SupervisedComputerServiceProcess,
    _exit: SupervisedComputerServiceExit,
  ): void {
    if (this.#current !== process) return;
    if (this.#state === "stopping" || this.#state === "closing") return;
    this.#current = undefined;
    this.#fatal("child_exited");
  }

  #scheduleHandoffDeadline(): void {
    this.#clearHandoffDeadline();
    this.#handoffTimer = setTimeout(() => {
      this.#handoffTimer = undefined;
      if (this.#state === "handoff_waiting" || this.#state === "launching") {
        this.#fatal("handoff_timed_out");
      }
    }, this.#handoffTimeoutMs);
  }

  #clearHandoffDeadline(): void {
    if (this.#handoffTimer === undefined) return;
    clearTimeout(this.#handoffTimer);
    this.#handoffTimer = undefined;
  }

  #fatal(
    reason: Extract<
      ComputerServiceSupervisorCompletion,
      { kind: "fatal" }
    >["reason"],
  ): void {
    this.#clearHandoffDeadline();
    this.#state = "closed";
    this.#finish({ kind: "fatal", reason });
  }

  #finish(result: ComputerServiceSupervisorCompletion): void {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#complete(Object.freeze(result));
  }
}

function normalizeProcess(
  value: SupervisedComputerServiceProcess,
  slot: Slot,
): SupervisedComputerServiceProcess {
  const processId = positiveInteger(value.processId, "processId");
  if (value.slot !== slot || typeof value.requestStop !== "function") {
    throw new Error("Computer supervisor launcher returned an invalid child");
  }
  if (!(value.exited instanceof Promise)) {
    throw new Error("Computer supervisor child exit proof is invalid");
  }
  return Object.freeze({
    exited: value.exited,
    processId,
    requestStop: () => value.requestStop(),
    slot,
  });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
