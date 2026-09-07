import { PdfReadingControls } from "./pdf-reading-controls.tsx";
import { pdfRasterSize } from "../pdf-reading.ts";
import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Mozilla getDocument/getPage/render lifecycle; PDF scripts/actions are never executed. */
export default function PdfAttachmentPreview({
  url,
  filename,
}: {
  url: string;
  filename: string;
}) {
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy>();
  const [zoom, setZoom] = useState(1);
  const [pageNumber, setPageNumber] = useState(1),
    [error, setError] = useState<string>();
  useEffect(() => {
    let closed = false;
    setDocument(undefined);
    setError(undefined);
    setPageNumber(1);
    setZoom(1);
    const loading = pdfjs.getDocument({
      url,
      useWasm: false,
      disableFontFace: true,
      cMapUrl: "/pdfjs-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs-assets/standard_fonts/",
      wasmUrl: "/pdfjs-assets/wasm/",
      iccUrl: "/pdfjs-assets/iccs/",
    });
    void loading.promise
      .then((doc) => {
        if (!closed) setDocument(doc);
      })
      .catch((e: Error) => {
        if (!closed)
          setError(
            e.name === "PasswordException"
              ? "此 PDF 需要密码，请下载后打开。"
              : `PDF 无法预览：${e.message}`,
          );
      });
    return () => {
      closed = true;
      void loading.destroy();
    };
  }, [url]);
  if (error) return <p role="alert">{error}</p>;
  if (!document) return <p role="status">正在解析 PDF…</p>;
  return (
    <div className="rah-pdf-preview">
      <PdfReadingControls
        page={pageNumber}
        total={document.numPages}
        zoom={zoom}
        onPage={setPageNumber}
        onZoom={setZoom}
      />
      <div className="rah-pdf-scroll" tabIndex={0} aria-label="PDF 页面阅读区">
        <PdfPage
          key={`${url}:${pageNumber}:${zoom}`}
          document={document}
          pageNumber={pageNumber}
          filename={filename}
          zoom={zoom}
        />
      </div>
    </div>
  );
}
function PdfPage({
  document,
  pageNumber,
  filename,
  zoom,
}: {
  document: pdfjs.PDFDocumentProxy;
  zoom: number;
  pageNumber: number;
  filename: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    let closed = false,
      render: pdfjs.RenderTask | undefined;
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (closed || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const size = pdfRasterSize(base.width, base.height, zoom);
      const viewport = page.getViewport({ scale: size.scale });
      canvas.current.width = size.width;
      canvas.current.height = size.height;
      render = page.render({ canvas: canvas.current, viewport });
      await render.promise;
      if (!closed) setReady(true);
      page.cleanup();
    })().catch((e: Error) => {
      if (!closed) setError(`PDF 页面无法显示：${e.message}`);
    });
    return () => {
      closed = true;
      render?.cancel();
    };
  }, [document, pageNumber, zoom]);
  return (
    <div style={{ width: `${zoom * 100}%` }}>
      {error ? (
        <p role="alert">{error}</p>
      ) : !ready ? (
        <p role="status">正在绘制页面…</p>
      ) : null}
      <canvas
        ref={canvas}
        className="rah-pdf-page"
        aria-label={`${filename} 第 ${pageNumber} 页`}
        data-pdf-rendered={ready ? "true" : "false"}
      />
    </div>
  );
}
