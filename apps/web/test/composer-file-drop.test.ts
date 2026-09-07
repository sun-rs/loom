import assert from "node:assert/strict";
import test from "node:test";
import { readDroppedFiles, isFileDrag } from "../src/composer-file-drop.ts";

const file = new File(["content"], "note.txt", { type: "text/plain" });
const entry = (value: File | null, directory = false) => ({
  kind: "file",
  getAsFile: () => value,
  webkitGetAsEntry: () => ({ isDirectory: directory }),
});
test("Raft file drops skip directories and duplicate item identities without traversing folders", () => {
  const result = readDroppedFiles({
    items: [
      entry(file),
      entry(file),
      entry(null, true),
      { kind: "string", getAsFile: () => null },
    ],
    files: [],
  });
  assert.deepEqual(result.files, [file]);
  assert.equal(result.error, "文件夹已被跳过——只能上传单个文件。");
  assert.equal(
    readDroppedFiles({ items: [entry(null, true)], files: [] }).error,
    "无法上传文件夹——请改为拖放单个文件。",
  );
});
test("FileList fallback is preserved and text dragging is not treated as an upload", () => {
  assert.deepEqual(readDroppedFiles({ items: [], files: [file] }), {
    files: [file],
  });
  assert.deepEqual(readDroppedFiles({ items: [entry(null)], files: [file] }), {
    files: [],
  });
  assert.equal(isFileDrag({ types: ["text/plain"] }), false);
  assert.equal(isFileDrag({ types: ["Files", "text/uri-list"] }), true);
});
