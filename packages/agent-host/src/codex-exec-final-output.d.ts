export type CodexExecFileSnapshot = {
  path: string;
  device: string;
  inode: string;
  regular: boolean;
  symlink: boolean;
  bytes: Uint8Array;
};
export type CodexExecFinalBinding = {
  launchId: string;
  expectedSessionId?: string;
  model: string;
  effort: string;
  /** Exact UTF-8 wake delivered to stdin, before launching the CLI. */
  inputSha256: string;
  outputPath: string;
  outputExistedBefore: boolean;
  rollout: {
    root: string;
    /** Resume uses all of path/device/inode; first launch uses existingPaths. */
    path?: string;
    device?: string;
    inode?: string;
    byteOffset: number;
    prefixSha256: string;
    existingPaths?: readonly string[];
  };
};
export type CodexExecTerminalEvidence = {
  launchId: string;
  exitCode: number | null;
  signal: string | null;
  /** Only true for a fully captured nontruncated stdout stream. */
  stdoutComplete: boolean;
  stdout: Uint8Array;
  output: CodexExecFileSnapshot;
  rollout: CodexExecFileSnapshot;
};
export type CodexExecFinalCandidate = Readonly<{
  launchId: string;
  sessionId: string;
  turnId: string;
  nativeMessageId: string;
  execItemId: string;
  text: string;
}>;
/** Pure native proof only. No filesystem I/O, Worker HTTP, or business state. */
export function createCodexExecFinalOutput(binding: CodexExecFinalBinding): {
  settle(
    evidence: CodexExecTerminalEvidence,
  ): CodexExecFinalCandidate | undefined;
};
/** Preserves an accepted native session even when the turn later fails. */
export function proveCodexExecInput(
  binding: CodexExecFinalBinding,
  evidence: Pick<
    CodexExecTerminalEvidence,
    "launchId" | "stdoutComplete" | "stdout" | "rollout"
  >,
):
  | Readonly<{ sessionId: string; turnId: string; inputSha256: string }>
  | undefined;
