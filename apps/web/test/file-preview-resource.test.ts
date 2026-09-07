import assert from "node:assert/strict";
import test from "node:test";
import { loadPreviewImage } from "../src/file-preview-resource.ts";

test("closing a preview before a late download never creates a retained image URL", async () => {
  const controller = new AbortController();
  let finish!: (blob: Blob) => void;
  let created = 0;
  const download = new Promise<Blob>((resolve) => (finish = resolve));
  const pending = loadPreviewImage(
    () => download,
    "image/png",
    controller.signal,
    {
      createObjectURL: () => {
        created++;
        return "blob:test";
      },
      revokeObjectURL: () => {},
    },
  );
  controller.abort();
  finish(new Blob(["image"]));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(created, 0);
});

test("closing a loaded preview releases exactly its own image URL", async () => {
  const controller = new AbortController(),
    released: string[] = [];
  const image = await loadPreviewImage(
    async () => new Blob(["image"]),
    "image/png",
    controller.signal,
    {
      createObjectURL: () => "blob:owned",
      revokeObjectURL: (url) => released.push(url),
    },
  );
  assert.equal(image, "blob:owned");
  controller.abort();
  controller.abort();
  assert.deepEqual(released, ["blob:owned"]);
});
