type ScopedOpenCodeEvent = {
  type: string;
  properties: Record<string, unknown>;
};
export function scopedOpenCodeEvent(
  event: unknown,
  activeSessionId: string | undefined,
): ScopedOpenCodeEvent | undefined;
export class OpenCodeEventIdentityFilter {
  accept(
    event: unknown,
    activeSessionId: string | undefined,
  ): ScopedOpenCodeEvent[];
}
export class OpenCodeChildSessions {
  observe(event: unknown, parentSessionId: string | undefined): void;
  has(sessionId: unknown): boolean;
}
export function isContextOverflowEvent(properties: unknown): boolean;
