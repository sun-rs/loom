import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProfileImageStore } from "../src/profile-image-store.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V7viPwAHwwMjerDEwwAAAABJRU5ErkJggg==",
  "base64",
);

test("profile images are validated, content addressed, immutable and readable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-images-"));
  try {
    const store = new ProfileImageStore({ directory });
    const first = await store.upload("image/png", chunks(PNG));
    const second = await store.upload("image/png", chunks(PNG));
    assert.deepEqual(second, first);
    assert.match(first.avatarKey, /^upload_png_[a-f0-9]{40}$/u);
    assert.equal(first.mimeType, "image/png");
    assert.equal(first.size, PNG.byteLength);

    const downloaded = store.read(first.avatarKey);
    const body: Buffer[] = [];
    for await (const chunk of downloaded.stream) body.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(body), PNG);
    assert.equal(downloaded.mimeType, "image/png");
    assert.equal(downloaded.size, PNG.byteLength);

    await assert.rejects(
      store.upload("image/jpeg", chunks(PNG)),
      /does not match/u,
    );
    await assert.rejects(
      store.upload("image/svg+xml", chunks(PNG)),
      /unsupported/u,
    );
    assert.throws(() => store.read("../human.token"), /invalid/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function* chunks(bytes: Uint8Array) {
  yield bytes.subarray(0, 12);
  yield bytes.subarray(12);
}
