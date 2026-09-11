import { randomUUID } from "node:crypto";
import type { RuntimeBusyNotice } from "./runtime.ts";

/** Private transport receipts, never Room delivery/ACK evidence. One write in flight. */
export class RuntimeBusyInput {
  #pending: { id: string; resolve: (accepted: boolean) => void } | undefined;
  receive(frame: unknown): boolean {
    if (
      typeof frame !== "object" ||
      frame === null ||
      !("protocol" in frame) ||
      frame.protocol !== "rah-runtime-notice-result/v1"
    )
      return false;
    const value = frame as Record<string, unknown>;
    if (value.id === this.#pending?.id)
      this.#pending?.resolve(value.accepted === true);
    return true;
  }
  async send(
    notice: RuntimeBusyNotice,
    write: (line: string) => Promise<void>,
  ): Promise<boolean> {
    if (this.#pending || !validBusyNotice(notice)) return false;
    const id = randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const receipt = new Promise<boolean>((resolve) => {
      this.#pending = { id, resolve };
      timer = setTimeout(() => resolve(false), 1500);
    });
    try {
      const written = write(
        `${JSON.stringify({ protocol: "rah-runtime-notice/v1", id, ...notice })}\n`,
      ).then(() => receipt);
      return await Promise.race([written, receipt]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      this.#pending = undefined;
    }
  }
}

export function validBusyNotice(notice: RuntimeBusyNotice): boolean {
  return (
    typeof notice.fingerprint === "string" &&
    notice.fingerprint.length === 64 &&
    typeof notice.text === "string" &&
    notice.text.length > 0 &&
    Buffer.byteLength(
      JSON.stringify({ fingerprint: notice.fingerprint, text: notice.text }),
    ) <= 5500
  );
}
