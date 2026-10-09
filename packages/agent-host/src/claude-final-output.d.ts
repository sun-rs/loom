export function createClaudeFinalOutput(binding: {
  sessionId: string;
  inputUuid: string;
}): {
  observe(frame: unknown): void;
  invalidate(): void;
  candidate(): { text: string; nativeMessageId: string } | undefined;
};
