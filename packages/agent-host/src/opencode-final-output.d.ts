export function openCodeFinalOutputCandidate(
  response: unknown,
  expected: { sessionId: string; parentId: string; nativeText?: boolean },
): { text: string; nativeMessageId: string } | undefined;
