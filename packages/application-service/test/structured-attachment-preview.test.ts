import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { buildStructuredPreview } from "../src/structured-attachment-preview.ts";
const preview = (filename: string, mimeType: string, body: Buffer | string) =>
  buildStructuredPreview(
    { filename, mimeType, size: Buffer.byteLength(body) },
    Readable.from([Buffer.from(body)]),
  );
test("official CSV preserves quoted cells and rejects binary disguised as CSV", async () => {
  const result = await preview(
    "data.csv",
    "text/csv",
    'name,value\n"a,b",12\n',
  );
  assert.equal(result.status, "ok");
  if (result.status === "ok" && result.data.kind === "csv")
    assert.deepEqual(result.data.rows, [["a,b", "12"]]);
  else assert.fail("CSV expected");
  assert.equal(
    (await preview("data.csv", "text/csv", Buffer.from([0, 1, 2]))).status,
    "unsupported",
  );
});
test("official Diff returns statistics and oversized CSV is unavailable", async () => {
  const result = await preview(
    "a.diff",
    "text/x-diff",
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n",
  );
  assert.deepEqual(result, {
    status: "ok",
    data: {
      kind: "diff",
      stats: { files: 1, hunks: 1, additions: 1, deletions: 1 },
    },
    truncated: false,
  });
  const result2 = await buildStructuredPreview(
    { filename: "big.csv", mimeType: "text/csv", size: 6 * 1024 * 1024 },
    Readable.from([]),
  );
  assert.equal(result2.status, "unsupported");
});

test("official XLSX reads sheets as inert strings and rejects invalid ZIP", async () => {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Value"],
      ["中文", 12],
    ]),
    "First",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Other"], ["Second sheet"]]),
    "Second",
  );
  const result = await preview(
    "book.xlsx",
    "application/octet-stream",
    XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }),
  );
  assert.equal(result.status, "ok");
  if (result.status === "ok" && result.data.kind === "xlsx") {
    assert.equal(result.data.sheetCount, 2);
    assert.deepEqual(result.data.sheets[0]?.rows, [["中文", "12"]]);
  } else assert.fail("XLSX expected");
  assert.equal(
    (await preview("bad.xlsx", "application/octet-stream", "not a zip")).status,
    "unsupported",
  );
});

test("CSV preview is bounded and marks omitted rows", async () => {
  const result = await preview(
    "many.csv",
    "text/csv",
    "n\n" + Array.from({ length: 250 }, (_, i) => String(i)).join("\n"),
  );
  assert.equal(result.status, "ok");
  if (result.status === "ok" && result.data.kind === "csv") {
    assert.equal(result.data.rows.length, 200);
    assert.equal(result.data.rowCount, 250);
    assert.equal(result.truncated, true);
  } else assert.fail("CSV expected");
});

test("adopted parser bytes differ only in recorded imports and type assertions", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const base = new URL("../vendor/raft/previews/", import.meta.url);
  const provenance = JSON.parse(
    readFileSync(new URL("provenance.json", base), "utf8"),
  );
  for (const [name, entry] of Object.entries(provenance.files) as [
    string,
    { sha256: string; upstreamSha256: string },
  ][]) {
    const source = readFileSync(new URL(name, base), "utf8");
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      entry.sha256,
    );
    const original = source
      .replaceAll('"./shared.ts"', '"@botiverse/raft-shared"')
      .replaceAll('"./types.ts"', '"../types"')
      .replaceAll('"./text.ts"', '"./text"')
      .replace("parsed[0]!.slice", "parsed[0].slice")
      .replace("localRanges[index - 1]!.end", "localRanges[index - 1].end")
      .replace("workbook.Sheets[name]!)", "workbook.Sheets[name])");
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      entry.upstreamSha256,
      name,
    );
  }
});
