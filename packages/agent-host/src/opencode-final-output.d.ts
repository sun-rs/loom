export function openCodeFinalOutputInstructions(
  prompt: string,
  enabled: boolean,
): string;
export function openCodeFinalOutputCandidate(
  response: unknown,
  expected: { sessionId: string; parentId: string },
): { text: string; nativeMessageId: string } | undefined;
