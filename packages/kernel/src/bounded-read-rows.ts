import { ForbiddenError } from "./errors.ts";
import type { Row } from "./sqlite-row.ts";

// The transport already caps JSON responses at 512 KiB. Keep complete rows and
// leave enough space for envelopes/cursors; omitted rows remain on the next page.
export function boundRows(
  rows: Row[],
  project: (row: Row) => unknown,
  drop: "first" | "last",
  anchorId?: string,
): Row[] {
  const selected = [...rows];
  const sizes = selected.map((row) =>
    Buffer.byteLength(JSON.stringify(project(row))),
  );
  let bytes = sizes.reduce((sum, size) => sum + size, 0);
  while (selected.length > 1 && bytes > 384 * 1024) {
    let removeFirst = drop === "first";
    if (anchorId !== undefined) {
      const anchor = selected.findIndex((row) => row.message_id === anchorId);
      removeFirst = anchor > (selected.length - 1) / 2;
    }
    bytes -= removeFirst ? sizes.shift()! : sizes.pop()!;
    if (removeFirst) selected.shift();
    else selected.pop();
  }
  if (bytes > 384 * 1024)
    throw new ForbiddenError(
      "one record exceeds the Worker read response limit",
    );
  return selected;
}
