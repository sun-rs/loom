import { useEffect, useState } from "react";
import { nextPdfScale, parsePdfPageNumber } from "../pdf-reading.ts";
export function PdfReadingControls({
  page,
  total,
  zoom,
  onPage,
  onZoom,
}: {
  page: number;
  total: number;
  zoom: number;
  onPage: (page: number) => void;
  onZoom: (scale: number) => void;
}) {
  const [draft, setDraft] = useState(String(page)),
    [error, setError] = useState<string>();
  useEffect(() => {
    setDraft(String(page));
    setError(undefined);
  }, [page]);
  return (
    <>
      <form
        className="rah-pdf-controls"
        onSubmit={(event) => {
          event.preventDefault();
          const next = parsePdfPageNumber(draft, total);
          if (next === undefined) {
            setError(`页码必须为 1–${total} 的整数。`);
            return;
          }
          setError(undefined);
          setDraft(String(next));
          onPage(next);
        }}
      >
        <button
          className="btn"
          type="button"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          上一页
        </button>
        <label className="rah-pdf-page-field">
          页码{" "}
          <input
            aria-label="PDF 页码"
            inputMode="numeric"
            value={draft}
            aria-invalid={!!error}
            maxLength={12}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <span role="status">
          {page} / {total}
        </span>
        <button className="btn" type="submit">
          跳转
        </button>
        <button
          className="btn"
          type="button"
          disabled={page === total}
          onClick={() => onPage(page + 1)}
        >
          下一页
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <div className="rah-pdf-controls" role="group" aria-label="PDF 缩放">
        <button
          className="btn"
          type="button"
          aria-label="缩小 PDF"
          disabled={zoom <= 0.1}
          onClick={() => onZoom(nextPdfScale(zoom, -1))}
        >
          −
        </button>
        <output aria-label="PDF 缩放比例">{Math.round(zoom * 100)}%</output>
        <button
          className="btn"
          type="button"
          aria-label="放大 PDF"
          disabled={zoom >= 25}
          onClick={() => onZoom(nextPdfScale(zoom, 1))}
        >
          +
        </button>
        <button className="btn" type="button" onClick={() => onZoom(1)}>
          适合宽度
        </button>
      </div>
    </>
  );
}
