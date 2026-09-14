import assert from "node:assert/strict";
import {
  existsSync,
  statSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
    const intents: string[] = [];
    const first = await store.upload(
      "image/png",
      chunks(PNG),
      ({ avatarKey }) => {
        intents.push(avatarKey);
        return "profile_image_upload_intent_first";
      },
    );
    const second = await store.upload(
      "image/png",
      chunks(PNG),
      ({ avatarKey }) => {
        intents.push(avatarKey);
        return "profile_image_upload_intent_second";
      },
    );
    assert.equal(second.avatarKey, first.avatarKey);
    assert.equal(second.mimeType, first.mimeType);
    assert.equal(second.size, first.size);
    assert.equal(first.uploadIntentId, "profile_image_upload_intent_first");
    assert.equal(second.uploadIntentId, "profile_image_upload_intent_second");
    assert.deepEqual(intents, [first.avatarKey, first.avatarKey]);
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
      store.upload("image/jpeg", chunks(PNG), () => "never"),
      /does not match/u,
    );
    await assert.rejects(
      store.upload("image/svg+xml", chunks(PNG), () => "never"),
      /unsupported/u,
    );
    assert.throws(() => store.read("../human.token"), /invalid/u);

    store.reclaim(first.avatarKey);
    assert.throws(() => store.read(first.avatarKey), /not found/u);
    store.reclaim(first.avatarKey);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("profile image publication cannot precede its durable upload intent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-images-intent-"));
  try {
    const store = new ProfileImageStore({ directory });
    await assert.rejects(
      store.upload("image/png", chunks(PNG), () => {
        throw new Error("intent database unavailable");
      }),
      /intent database unavailable/u,
    );
    await assert.rejects(
      store.upload("image/png", chunks(PNG), () => ""),
      /too_small|at least 1 character/u,
    );
    assert.deepEqual(store.inventory(), []);
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup cleanup removes only strict stale profile-image part files", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-images-part-"));
  try {
    const store = new ProfileImageStore({ directory });
    const stale = `.upload_png_${"a".repeat(40)}.123e4567-e89b-12d3-a456-426614174000.part`;
    const unrelated = "keep.part";
    writeFileSync(join(directory, stale), PNG, { mode: 0o600 });
    writeFileSync(join(directory, unrelated), PNG, { mode: 0o600 });
    utimesSync(join(directory, stale), new Date(0), new Date(0));
    assert.equal(store.reclaimStaleParts({ olderThanMs: 1 }), 1);
    assert.equal(existsSync(join(directory, stale)), false);
    assert.equal(existsSync(join(directory, unrelated)), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function* chunks(bytes: Uint8Array) {
  yield bytes.subarray(0, 12);
  yield bytes.subarray(12);
}

test("filesystem fractional milliseconds become safe inventory timestamps without shortening GC grace", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-profile-fractional-"));
  try {
    const store = new ProfileImageStore({ directory });
    const avatarKey = "upload_png_" + "a".repeat(40);
    const path = join(directory, avatarKey);
    writeFileSync(path, PNG);
    utimesSync(path, 1000.123456, 1000.123456);
    const raw = statSync(path).mtimeMs;
    assert.equal(
      Number.isInteger(raw),
      false,
      "reproduce sub-millisecond filesystem metadata",
    );
    assert.deepEqual(store.inventory(), [
      { avatarKey, modifiedAtMs: Math.ceil(raw) },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
