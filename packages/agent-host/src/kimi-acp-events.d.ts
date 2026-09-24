export function kimiCompactionCompleted(
  update: unknown,
):
  | { compactedCount: number; tokensBefore: number; tokensAfter: number }
  | undefined;
export function isKimiCompactionStarted(update: unknown): boolean;
export function isKimiLocalChunk(update: unknown): boolean;
export function isKimiTurnModelUpdate(update: unknown): boolean;
