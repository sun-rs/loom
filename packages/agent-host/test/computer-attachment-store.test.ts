import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COMPUTER_ATTACHMENT_STORE_SCHEMA_VERSION,
  ComputerAttachmentStore,
  ComputerAttachmentStoreFormatError,
  type ComputerAttachment,
} from "../src/index.ts";

function attachment(attachmentId = "attachment-primary"): ComputerAttachment {
  return {
    attachmentId,
    connectionId: `connection-${attachmentId}`,
    createdAt: "2026-08-28T00:00:00.000Z",
    hostAccessToken: `rah_host_${"a".repeat(48)}`,
    origin: "https://control.example.test",
  };
}

test("Computer attachments are atomically persisted in owner-private storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-computer-attachments-"));
  const statePath = join(directory, "attachments.json");
  try {
    const store = new ComputerAttachmentStore({ statePath });
    assert.deepEqual(await store.read(), []);

    const records = [attachment(), attachment("attachment-secondary")];
    await store.save(records);
    assert.equal(lstatSync(statePath).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(), records);
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.includes(".tmp-")),
      [],
    );
    const envelope = JSON.parse(readFileSync(statePath, "utf8")) as {
      attachments: unknown[];
      schemaVersion: number;
    };
    assert.equal(
      envelope.schemaVersion,
      COMPUTER_ATTACHMENT_STORE_SCHEMA_VERSION,
    );
    assert.equal(envelope.attachments.length, 2);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Computer attachment store rejects duplicate stable identities and insecure origins", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-computer-attachment-format-"),
  );
  try {
    const store = new ComputerAttachmentStore({
      statePath: join(directory, "attachments.json"),
    });
    await assert.rejects(
      store.save([attachment(), attachment()]),
      (error: unknown) =>
        error instanceof ComputerAttachmentStoreFormatError &&
        /duplicate attachmentId/u.test(error.message),
    );
    await assert.rejects(
      store.save([
        {
          ...attachment(),
          origin: "http://192.0.2.20:4174",
        },
      ]),
      /HTTPS/u,
    );
    await assert.rejects(
      store.save([
        {
          ...attachment(),
          createdAt: "2026-08-28T00:00:00",
        },
      ]),
      /ISO timestamp/u,
    );
    await assert.rejects(
      store.save(
        Array.from({ length: 129 }, (_, index) =>
          attachment(`attachment-${String(index)}`),
        ),
      ),
      /at most 128/u,
    );
    await assert.rejects(
      store.save(
        Array.from({ length: 128 }, (_, index) => ({
          ...attachment(`large-${String(index)}`),
          hostAccessToken: "t".repeat(4_096),
        })),
      ),
      /256 KiB/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Computer attachment store fails closed on symlinks, corrupt files, and newer schemas", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-computer-attachment-security-"),
  );
  const statePath = join(directory, "attachments.json");
  try {
    const targetPath = join(directory, "target.json");
    writeFileSync(targetPath, "{}", { mode: 0o600 });
    symlinkSync(targetPath, statePath);
    const store = new ComputerAttachmentStore({ statePath });
    await assert.rejects(store.read(), /symbolic link/u);
    await assert.rejects(store.save([attachment()]), /symbolic link/u);
    rmSync(statePath);

    writeFileSync(statePath, '{"schemaVersion":1,"attachments":', {
      mode: 0o600,
    });
    await assert.rejects(store.read(), /valid JSON/u);

    writeFileSync(
      statePath,
      JSON.stringify({ attachments: [], schemaVersion: 2 }),
      { mode: 0o600 },
    );
    await assert.rejects(store.read(), /newer Computer attachment schema 2/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Computer attachment store rejects non-private credential files and parents", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "rah-computer-attachment-mode-"),
  );
  const statePath = join(directory, "attachments.json");
  try {
    const store = new ComputerAttachmentStore({ statePath });
    await store.save([attachment()]);
    chmodSync(statePath, 0o644);
    await assert.rejects(store.read(), /owner-private regular file/u);

    rmSync(statePath);
    chmodSync(directory, 0o755);
    await assert.rejects(
      store.save([attachment()]),
      /owner-private directory/u,
    );
  } finally {
    chmodSync(directory, 0o700);
    rmSync(directory, { force: true, recursive: true });
  }
});
