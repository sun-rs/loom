export function openCodeFinalOutputCandidate(
  response: unknown,
  expected: { sessionId: string; parentId: string },
): { text: string; nativeMessageId: string } | undefined;
