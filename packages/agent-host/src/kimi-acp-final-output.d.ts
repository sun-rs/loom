export type KimiFinalWire = {
  path: string;
  device: string;
  inode: string;
  offset: number;
  prefixSha256: string;
};
export type KimiAcpFinalBinding = {
  launchId: string;
  sessionId: string;
  promptId: number;
  promptText: string;
  model: string;
  effort: string;
  wire: KimiFinalWire;
};
export type KimiAcpFinalCandidate = Readonly<{
  launchId: string;
  sessionId: string;
  turnId: string;
  nativeMessageId: string;
  text: string;
}>;
export function createKimiAcpFinalOutput(binding: KimiAcpFinalBinding): {
  observe(sessionId: string, update: unknown): void;
  settle(evidence: {
    launchId: string;
    sessionId: string;
    promptId: number;
    stopReason: string;
    cancelled: boolean;
    wire: KimiFinalWire & { suffix: string };
  }): KimiAcpFinalCandidate | undefined;
};
