type RequestJson = (path: string) => Promise<unknown>;
type ChildSessions = {
  has(sessionId: unknown): boolean;
  add(sessionId: string): void;
};
export function extractSseData(buffer: string): {
  items: string[];
  remainder: string;
};
export function openCodeEventError(properties: Record<string, unknown>): string;
export function abortedByInterrupt(response: unknown): boolean;
export function serverAuthHeader(
  environment?: NodeJS.ProcessEnv,
): string | undefined;
export function safeResponseText(response: Response): Promise<string>;
export function boundedServerOutput(
  tail: Buffer,
  chunk: Buffer | string,
  maximum: number,
): Buffer;
export function verifyOpenCodeChildSession(options: {
  childSessions: ChildSessions;
  parentSessionId: string | undefined;
  requestJson: RequestJson;
  sessionId: unknown;
}): Promise<boolean>;
export function preloadOpenCodeChildSessions(options: {
  childSessions: ChildSessions;
  parentSessionId: string;
  requestJson: RequestJson;
}): Promise<void>;
export function pendingOpenCodeRequests(
  requestJson: RequestJson,
): Promise<{ type: string; properties: Record<string, unknown> }[]>;
export function openCodeStepFinishPart(
  event: unknown,
): Record<string, unknown> | undefined;
export function stringField(value: unknown, name: string): string | undefined;
export function record(value: unknown): Record<string, unknown>;
export function isRecord(value: unknown): value is Record<string, unknown>;
