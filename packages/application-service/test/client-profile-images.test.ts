import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { HttpRahClient } from "@rah-os/client-sdk";
import { RoomKernel, createHumanApplicationPort } from "@rah-os/kernel";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientApplicationService } from "../src/index.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V7viPwAHwwMjerDEwwAAAABJRU5ErkJggg==",
  "base64",
);

test("profile image HTTP transport uploads and serves an authenticated inline image", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-client-profile-image-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(kernel),
    health: () => ({
      apiVersion: 3,
      buildVersion: "test",
      capabilities: {} as never,
      kernelSchemaVersion: 29,
      protocolVersion: 1,
      state: "online",
    }),
    profileImages: {
      upload: async (_actor, mimeType, stream) => {
        const bytes: Buffer[] = [];
        for await (const chunk of stream) bytes.push(Buffer.from(chunk));
        assert.equal(mimeType, "image/png");
        assert.deepEqual(Buffer.concat(bytes), PNG);
        return {
          avatarKey: "upload_png_0123456789abcdef0123456789abcdef01234567",
          mimeType: "image/png" as const,
          size: PNG.byteLength,
          uploadIntentId: "profile_image_upload_intent_test",
        };
      },
      read: (_actor, avatarKey) => {
        assert.equal(
          avatarKey,
          "upload_png_0123456789abcdef0123456789abcdef01234567",
        );
        return {
          mimeType: "image/png" as const,
          size: PNG.byteLength,
          stream: Readable.from(PNG),
        };
      },
    },
  });
  try {
    await service.start();
    const client = new HttpRahClient({
      accessToken: () => human.accessToken,
      baseUrl: service.origin,
    });
    const uploaded = await client.profileImages.upload(
      new Blob([PNG], { type: "image/png" }),
    );
    assert.match(uploaded.avatarKey, /^upload_png_/u);
    assert.equal(uploaded.uploadIntentId, "profile_image_upload_intent_test");

    const withoutAuth = await fetch(
      client.profileImages.url(uploaded.avatarKey),
    );
    assert.equal(withoutAuth.status, 401);
    const response = await fetch(client.profileImages.url(uploaded.avatarKey), {
      headers: { authorization: `Bearer ${human.accessToken}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-disposition"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);

    const invalidMedia = await fetch(
      `${service.origin}/v3/client/profile-images/content`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${human.accessToken}`,
          "content-type": "image/svg+xml",
        },
        body: "<svg/>",
      },
    );
    assert.equal(invalidMedia.status, 415);
    assert.equal(
      ((await invalidMedia.json()) as { error: { code: string } }).error.code,
      "unsupported_media_type",
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
