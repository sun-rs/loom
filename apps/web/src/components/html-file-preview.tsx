import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import bridgeAsset from "../html-preview-bridge.js?url&no-inline";
import {
  attachmentAnchorTarget,
  type AttachmentAnchor,
} from "../attachment-comment-anchors.ts";

// vYe's source/nonce boundary, adapted to local immutable srcdoc. No attachment
// script is permitted, including scripts preceding <head> or event attributes.
export function HtmlFilePreview({
  filename,
  text,
  commentMode,
  onAnchor,
}: {
  filename: string;
  text: string;
  commentMode: boolean;
  onAnchor: ((anchor: AttachmentAnchor) => void) | undefined;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => browserOpaqueId());
  const latest = useRef({ commentMode, onAnchor });
  latest.current = { commentMode, onAnchor };
  const source = useMemo(() => {
    const doc = new DOMParser().parseFromString(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">' +
        text,
      "text/html",
    );
    doc
      .querySelectorAll("script,meta,base,iframe,object,embed")
      .forEach((node) => node.remove());
    const url = new URL(bridgeAsset, window.location.href).href;
    const csp = doc.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = `default-src 'none'; script-src ${url}; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'`;
    doc.head.prepend(csp);
    const script = doc.createElement("script");
    script.src = url;
    script.dataset.channel = channel;
    doc.body.append(script);
    return "<!doctype html>" + doc.documentElement.outerHTML;
  }, [text, channel]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const send = (data: object) =>
      element.contentWindow?.postMessage({ rahHtml: channel, ...data }, "*");
    const receive = (event: MessageEvent) => {
      if (
        event.source !== element.contentWindow ||
        !event.data ||
        event.data.rahHtml !== channel
      )
        return;
      if (event.data.type === "ready") {
        element.dataset.rahHtmlReady = "true";
        send({ type: "mode", enabled: latest.current.commentMode });
      }
      if (event.data.type === "anchor" && latest.current.commentMode) {
        const data = event.data.data;
        if (!data || typeof data !== "object") return;
        const anchor = { type: "html-region", data };
        if (attachmentAnchorTarget(anchor, "html"))
          latest.current.onAnchor?.(anchor);
      }
    };
    const jump = (event: Event) => {
      const anchor = (event as CustomEvent<AttachmentAnchor>).detail;
      if (anchor && attachmentAnchorTarget(anchor, "html"))
        send({ type: "jump", data: anchor.data });
    };
    window.addEventListener("message", receive);
    element.addEventListener("rah-html-jump", jump);
    send({ type: "mode", enabled: latest.current.commentMode });
    return () => {
      window.removeEventListener("message", receive);
      element.removeEventListener("rah-html-jump", jump);
    };
  }, [channel, source]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { rahHtml: channel, type: "mode", enabled: commentMode },
      "*",
    );
  }, [channel, commentMode]);
  return (
    <iframe
      ref={frame}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={source}
      title={"HTML 预览 " + filename}
    />
  );
}
