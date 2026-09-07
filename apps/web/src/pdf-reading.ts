// Structural port of pdfjs-dist 6.3.289 PDFViewer.updateScale (Mozilla, Apache-2.0).
export function nextPdfScale(scale: number, direction: 1 | -1): number {
  const value = Number((scale * (direction > 0 ? 1.1 : 1 / 1.1)).toFixed(2));
  return Math.max(
    0.1,
    Math.min(25, (direction > 0 ? Math.ceil : Math.floor)(value * 10) / 10),
  );
}
export function parsePdfPageNumber(
  value: string,
  total: number,
): number | undefined {
  if (!/^\d+$/.test(value.trim())) return undefined;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= total
    ? page
    : undefined;
}
/** Keep the existing 4M-pixel budget independently of CSS magnification. */
export function pdfRasterSize(width: number, height: number, zoom: number) {
  if (![width, height, zoom].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("PDF 页面尺寸无效");
  const scale = Math.min(
    2 * zoom,
    (1600 * zoom) / width,
    Math.sqrt(4_000_000 / (width * height)),
    16384 / width,
    16384 / height,
  );
  const pixelsWide = Math.max(1, Math.floor(width * scale));
  const pixelsHigh = Math.max(
    1,
    Math.min(Math.floor(height * scale), Math.floor(4_000_000 / pixelsWide)),
  );
  return { width: pixelsWide, height: pixelsHigh, scale };
}
