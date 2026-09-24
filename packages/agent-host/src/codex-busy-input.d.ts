import type { Readable } from "node:stream";
export function attachCodexBusyInput(options: {
  input: Readable;
  state: () => { threadId?: string; turnId?: string; stopping: boolean };
  request: (
    method: string,
    params: unknown,
    timeoutMs: number,
  ) => Promise<unknown>;
  receipt?: (frame: {
    protocol: string;
    id: string;
    accepted: boolean;
  }) => unknown;
}): {
  observe(frame: { method: string; params?: Record<string, unknown> }): void;
  close(): void;
  /** Resolves once no turn/steer request is awaiting its response. */
  settled(): Promise<void>;
};
