/** Raft composer drop item contract; provenance: docs/design/composer-file-drop.md. */
type DropItem = {
  kind: string;
  getAsFile(): File | null;
  webkitGetAsEntry?: () => { isDirectory: boolean } | null;
};
export function isFileDrag(transfer: { types: readonly string[] }) {
  return Array.from(transfer.types).includes("Files");
}
export function readDroppedFiles(transfer: {
  items: ArrayLike<DropItem>;
  files: ArrayLike<File>;
}): { files: File[]; error?: string } {
  if (!transfer.items.length) return { files: Array.from(transfer.files) };
  const files: File[] = [],
    seen = new Set<string>();
  let folders = false;
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== "file") continue;
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      folders = true;
      continue;
    }
    const file = item.getAsFile();
    if (!file) continue;
    const key = `${file.name}::${file.size}::${file.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      files.push(file);
    }
  }
  return {
    files,
    ...(folders
      ? {
          error: files.length
            ? "文件夹已被跳过——只能上传单个文件。"
            : "无法上传文件夹——请改为拖放单个文件。",
        }
      : {}),
  };
}
