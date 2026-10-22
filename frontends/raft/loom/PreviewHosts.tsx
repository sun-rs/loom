import { lazy, Suspense, Component, type ReactNode } from "react";
import { Spinner } from "raft-ui";
import Lightbox from "../packages/web/src/components/ui/Lightbox.tsx";
import CloseButton from "../packages/web/src/components/ui/CloseButton.tsx";
import { useDocumentPreviewStore } from "../packages/web/src/store/documentPreviewStore.ts";
import { useMediaPreviewStore } from "../packages/web/src/store/mediaPreviewStore.ts";
import { useImageLightboxStore } from "../packages/web/src/store/imageLightboxStore.ts";
import { hasRouteBoundIntent } from "./useIntentRoute.ts";
const DocumentPreview = lazy(() => import("./DocumentPreview.tsx"));
const HtmlPreview = lazy(() => import("./HtmlPreview.tsx"));
const ImageLightbox = lazy(
  () => import("../packages/web/src/components/ImageLightbox.tsx"),
);
function LoadingPreview({
  onClose,
  failed = false,
}: {
  onClose: () => void;
  failed?: boolean;
}) {
  return (
    <Lightbox
      onClose={onClose}
      backdropClass="bg-layer-canvas"
      className="flex items-center justify-center"
    >
      <div role="status" className="flex items-center gap-2 text-foreground">
        {!failed && <Spinner />}
        {failed ? "预览加载失败，请刷新后重试" : "正在加载预览"}
      </div>
      <CloseButton
        onClick={onClose}
        aria-label="关闭预览"
        className="absolute top-4 right-4"
        data-loom-control="detail-close"
      />
    </Lightbox>
  );
}
class PreviewBoundary extends Component<
  { onClose: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <LoadingPreview failed onClose={this.props.onClose} />
    ) : (
      this.props.children
    );
  }
}
/** Only the cheap official stores are eager. Presentation still belongs to the official hosts. */
export default function PreviewHosts() {
  const documentOpen = useDocumentPreviewStore((s) => !!s.entry);
  const htmlOpen = useMediaPreviewStore((s) => s.entry?.kind === "html");
  const imageOpen = useImageLightboxStore((s) => s.isOpen);
  const closeDocument = () => {
    if (!hasRouteBoundIntent()) useDocumentPreviewStore.getState().close();
  };
  const closeHtml = () => {
    if (!hasRouteBoundIntent()) useMediaPreviewStore.getState().close();
  };
  return (
    <>
      {documentOpen && (
        <PreviewBoundary onClose={closeDocument}>
          <Suspense fallback={<LoadingPreview onClose={closeDocument} />}>
            <DocumentPreview />
          </Suspense>
        </PreviewBoundary>
      )}
      {htmlOpen && (
        <PreviewBoundary onClose={closeHtml}>
          <Suspense fallback={<LoadingPreview onClose={closeHtml} />}>
            <HtmlPreview />
          </Suspense>
        </PreviewBoundary>
      )}
      {imageOpen && (
        <PreviewBoundary
          onClose={() => useImageLightboxStore.getState().close()}
        >
          <Suspense
            fallback={
              <LoadingPreview
                onClose={() => useImageLightboxStore.getState().close()}
              />
            }
          >
            <ImageLightbox />
          </Suspense>
        </PreviewBoundary>
      )}
    </>
  );
}
