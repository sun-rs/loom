import type { Readable } from "node:stream";
export function attachClaudeBusyInput(options: {
  input: Readable;
  resumedSession?: boolean;
  session: () => string | undefined;
  write: (text: string, done: (error?: Error | null) => void) => unknown;
  receipt?: (frame: {
    protocol: string;
    id: string;
    accepted: boolean;
  }) => unknown;
}): {
  readonly writtenCount: number;
  observe(frame: Record<string, unknown>): void;
  close(): void;
};
