import { MAX_ATTACHMENT_MEDIA_PREVIEW_BYTES } from "@rah-os/protocol";
// FilePreview's image resource lifetime. The request's AbortSignal owns cleanup.
export async function loadPreviewImage(
  download: () => Promise<Blob>,
  mimeType: string,
  signal: AbortSignal,
  urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
): Promise<string> {
  let url: string | undefined;
  signal.addEventListener(
    "abort",
    () => {
      if (url) urls.revokeObjectURL(url);
    },
    { once: true },
  );
  signal.throwIfAborted();
  const blob = await download();
  signal.throwIfAborted();
  url = urls.createObjectURL(new Blob([blob], { type: mimeType }));
  return url;
}

export function loadPreviewMedia(
  download: () => Promise<Blob>,
  expectedSize: number,
  mimeType: string,
  signal: AbortSignal,
  urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
): Promise<string> {
  if (expectedSize > MAX_ATTACHMENT_MEDIA_PREVIEW_BYTES)
    return Promise.reject(
      new Error("此媒体超过 20 MiB 内嵌预览上限，请下载查看。"),
    );
  return loadPreviewImage(
    async () => {
      const blob = await download();
      if (blob.size !== expectedSize)
        throw new Error("文件大小与记录不一致，请重新下载。");
      return blob;
    },
    mimeType,
    signal,
    urls,
  );
}
