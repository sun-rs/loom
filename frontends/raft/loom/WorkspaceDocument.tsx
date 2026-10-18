import WorkspaceFileContent from "./WorkspaceFileContent.tsx";
import { useState } from "react";
import { Button } from "raft-ui";
import {
  DocumentAttachmentPreviewModal,
  HtmlAttachmentPreviewModal,
} from "../packages/web/src/components/message/attachmentPreviewSurfaces.tsx";
import type {
  AgentWorkspaceFile,
  ChannelWorkspaceReadRequest,
} from "@rah-os/protocol";
/** Native attachment surfaces over a read-only workspace capability, without attachment identity/comments. */
export default function WorkspaceDocument({
  file,
  request,
}: {
  file: AgentWorkspaceFile;
  request: ChannelWorkspaceReadRequest;
}) {
  const [url, setUrl] = useState<string>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const html = /\.html?$/i.test(file.path);
  async function open() {
    setBusy(true);
    setError("");
    const endpoint =
      "/_rah/workspace-preview/" +
      (html ? "html" : "pdf") +
      "?input=" +
      encodeURIComponent(JSON.stringify(request));
    try {
      if (html) setUrl(new URL(endpoint, window.location.origin).href);
      else {
        const response = await fetch(endpoint, { method: "POST" });
        if (!response.ok) throw Error("PDF 预览不可用");
        setUrl((await response.json()).url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览不可用");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const bytes =
      file.encoding === "base64"
        ? Uint8Array.from(atob(file.content ?? ""), (c) => c.charCodeAt(0))
        : (file.content ?? "");
    const href = URL.createObjectURL(
      new Blob([bytes], { type: html ? "text/html" : file.mimeType }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = file.path.split("/").at(-1)!;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const props = {
    filename: file.path,
    url: url ?? "",
    onClose: () => setUrl(undefined),
    onDownload: download,
  };
  return (
    <>
      <Button onClick={() => void open()} disabled={busy}>
        打开预览
      </Button>
      {error && <p role="alert">{error}</p>}
      {html && (
        <WorkspaceFileContent text={file.content ?? ""} markdown={false} />
      )}
      {url &&
        (html ? (
          <HtmlAttachmentPreviewModal {...props} />
        ) : (
          <DocumentAttachmentPreviewModal
            {...props}
            preview={{ kind: "pdf" }}
            truncated={false}
            onCopyError={() => setError("无法复制")}
          />
        ))}
    </>
  );
}
