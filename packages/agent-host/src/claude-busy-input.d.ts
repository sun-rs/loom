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
  /** Host `rah-final-reply/v1` control frames on the same pipe. */
  control?: (frame: Record<string, unknown>) => void;
}): {
  readonly writtenCount: number;
  readonly writtenUuids: ReadonlySet<string>;
  observe(frame: Record<string, unknown>): void;
  close(): void;
};
