export function openCodeInstructionsDirectory(): string;
export function prepareOpenCodeInstructionsFile(
  rules: string,
  directory?: string,
): string;
export function openCodeConfigContentWithInstructions(
  inherited: string | undefined,
  path: string,
): string;
export function openCodeMessageId(now?: number): string;
