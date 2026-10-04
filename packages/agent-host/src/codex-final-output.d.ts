export function createCodexFinalOutput(binding: {
  threadId: string;
  turnId: string;
}): {
  observe(frame: unknown): void;
  candidate(): { text: string; nativeMessageId: string } | undefined;
};
