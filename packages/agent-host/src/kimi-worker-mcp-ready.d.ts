export class KimiWorkerMcpReady {
  observe(frame: unknown): void;
  wait(
    sessionId: string,
    request: (
      method: string,
      params: unknown,
      timeoutMs: number,
    ) => Promise<unknown>,
  ): Promise<void>;
}
