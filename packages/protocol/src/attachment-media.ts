/** Raft Ott/mle/fle dispatch; canonical MIME prevents active HTML masquerading as media. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  weba: "audio/webm",
  flac: "audio/flac",
};
const MIME_TYPES = new Set([
  ...Object.values(EXTENSIONS),
  "audio/mp3",
  "audio/x-wav",
  "audio/wave",
  "audio/x-m4a",
  "audio/x-flac",
]);
export function attachmentMediaPreview(
  mimeType: string,
  filename: string,
): { kind: "pdf" | "video" | "audio"; mimeType: string } | undefined {
  const normalized = mimeType.toLowerCase().split(";", 1)[0]!.trim();
  const basename = filename.toLowerCase().split(/[\\/]/u).at(-1) ?? "";
  const extension = basename.includes(".") ? basename.split(".").at(-1)! : "";
  const mime = MIME_TYPES.has(normalized) ? normalized : EXTENSIONS[extension];
  if (!mime) return undefined;
  return {
    kind:
      mime === "application/pdf"
        ? "pdf"
        : mime.startsWith("video/")
          ? "video"
          : "audio",
    mimeType: mime,
  };
}
export const MAX_ATTACHMENT_MEDIA_PREVIEW_BYTES = 20 * 1024 * 1024;
