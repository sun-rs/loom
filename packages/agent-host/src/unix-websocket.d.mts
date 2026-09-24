import type { Socket } from "node:net";

export type UnixWebSocketConnection = {
  readonly open: boolean;
  /** Messages received before a listener is installed are queued for it. */
  onMessage: (text: string) => void;
  /** A close before a listener is installed is delivered when it is. */
  onClose: (error?: Error) => void;
  send(text: string): void;
  close(): void;
  feed(chunk: Buffer): void;
};

export function connectUnixWebSocket(
  socketPath: string,
  options?: { timeoutMs?: number },
): Promise<UnixWebSocketConnection>;

export function acceptUnixWebSocket(
  socket: Socket,
): Promise<UnixWebSocketConnection>;
