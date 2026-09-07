import assert from "node:assert/strict";
import test from "node:test";
import { loadPreviewMedia } from "../src/file-preview-resource.ts";

test("oversize media refuses before downloading; inaccurate bytes never become a URL", async () => {
  let requests = 0,
    allocated = 0;
  const urls = {
    createObjectURL: () => {
      allocated++;
      return "blob:test";
    },
    revokeObjectURL: () => {},
  };
  const download = async () => {
    requests++;
    return new Blob(["pdf"]);
  };
  const signal = new AbortController().signal;
  await assert.rejects(
    loadPreviewMedia(
      download,
      20 * 1024 * 1024 + 1,
      "application/pdf",
      signal,
      urls,
    ),
    /20 MiB/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    loadPreviewMedia(download, 8, "application/pdf", signal, urls),
    /大小/,
  );
  assert.equal(allocated, 0);
});

test("a closed media preview cannot allocate a late URL and a loaded one releases it", async () => {
  const controller = new AbortController();
  let complete!: (blob: Blob) => void;
  const pending = new Promise<Blob>((resolve) => (complete = resolve));
  const urls = {
    createObjectURL: () => {
      throw new Error("late allocation");
    },
    revokeObjectURL: () => {},
  };
  const result = loadPreviewMedia(
    () => pending,
    3,
    "audio/wav",
    controller.signal,
    urls,
  );
  controller.abort();
  complete(new Blob(["wav"]));
  await assert.rejects(result, { name: "AbortError" });
  const loaded = new AbortController(),
    released: string[] = [];
  assert.equal(
    await loadPreviewMedia(
      async () => new Blob(["wav"]),
      3,
      "audio/wav",
      loaded.signal,
      {
        createObjectURL: () => "blob:media",
        revokeObjectURL: (url) => released.push(url),
      },
    ),
    "blob:media",
  );
  loaded.abort();
  assert.deepEqual(released, ["blob:media"]);
});
