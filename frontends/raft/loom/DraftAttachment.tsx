import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import {
  ComposerAttachment,
  ComposerAttachmentBody,
  ComposerAttachmentFile,
  ComposerAttachmentImage,
  ComposerAttachmentTitle,
  ComposerAttachmentMeta,
  ComposerAttachmentRemove,
  ComposerAttachmentUploadingOverlay,
  ComposerAttachmentFailedOverlay,
  Spinner,
} from "raft-ui";
import type { DraftFile } from "./file-uploads.ts";
import { transparentImageBackgroundClass } from "../packages/web/src/utils/imagePreviewStyles.ts";
export default function DraftAttachment({
  row,
  disabled,
  remove,
}: {
  row: DraftFile;
  disabled: boolean;
  remove: () => void;
}) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(row.file.type)) return;
    const url = URL.createObjectURL(row.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [row.file]);
  return (
    <ComposerAttachment data-upload-status={row.status} title={row.file.name}>
      <div className={preview ? "size-full" : ""}>
        {preview ? (
          <ComposerAttachmentImage>
            <img
              src={preview}
              alt={row.file.name}
              className={
                "size-full object-cover " + transparentImageBackgroundClass
              }
            />
          </ComposerAttachmentImage>
        ) : (
          <ComposerAttachmentFile>
            <FileText size={16} />
            <ComposerAttachmentBody>
              <ComposerAttachmentTitle>{row.file.name}</ComposerAttachmentTitle>
              <ComposerAttachmentMeta>
                {row.file.type || "文件"}
              </ComposerAttachmentMeta>
            </ComposerAttachmentBody>
          </ComposerAttachmentFile>
        )}
      </div>
      {row.status === "uploading" && (
        <ComposerAttachmentUploadingOverlay>
          <Spinner size="sm" />
          <span>上传中…</span>
        </ComposerAttachmentUploadingOverlay>
      )}
      {row.status === "failed" && (
        <ComposerAttachmentFailedOverlay>
          <span role="alert">{row.error}</span>
        </ComposerAttachmentFailedOverlay>
      )}
      <ComposerAttachmentRemove
        disabled={disabled}
        aria-label={"移除 " + row.file.name}
        onClick={remove}
      />
    </ComposerAttachment>
  );
}
