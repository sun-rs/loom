import assert from "node:assert/strict";
import test from "node:test";

import {
  ComputerDoctor,
  type ComputerAttachment,
  type ComputerAttachmentManagerSnapshot,
  type ComputerAttachmentStorePort,
} from "../src/index.ts";

const secret = `rah_host_${"s".repeat(48)}`;
const attachment: ComputerAttachment = {
  attachmentId: "attachment-doctor",
  connectionId: "connection-doctor",
  createdAt: "2026-08-28T00:00:00.000Z",
  hostAccessToken: secret,
  origin: "https://control.example.test",
};

function store(records: ComputerAttachment[]): ComputerAttachmentStorePort {
  return { read: async () => records };
}

function snapshot(
  state: "connected" | "degraded" | "disconnected",
): ComputerAttachmentManagerSnapshot {
  return {
    attachments: {
      "attachment-doctor": {
        consecutiveFailures: state === "connected" ? 0 : 1,
        ...(state === "degraded"
          ? { terminalReason: "attachment_revoked" as const }
          : {}),
        state,
      },
    },
    state: "running",
  };
}

test("Computer doctor reports a reconciled attachment without exposing credentials", async () => {
  const doctor = new ComputerDoctor({
    attachmentSnapshot: () => snapshot("connected"),
    attachmentStore: store([attachment]),
  });

  const report = await doctor.run();
  assert.equal(report.status, "healthy");
  assert.ok(report.checks.every((check) => check.status === "pass"));
  assert.ok(!JSON.stringify(report).includes(secret));
});

test("Computer doctor distinguishes revocation from retryable disconnection", async () => {
  const revoked = await new ComputerDoctor({
    attachmentSnapshot: () => snapshot("degraded"),
    attachmentStore: store([attachment]),
  }).run();
  assert.equal(revoked.status, "degraded");
  assert.equal(
    revoked.checks.find((check) => check.id === "attachment:attachment-doctor")
      ?.status,
    "fail",
  );
  assert.match(JSON.stringify(revoked), /revoked/u);

  const offline = await new ComputerDoctor({
    attachmentSnapshot: () => snapshot("disconnected"),
    attachmentStore: store([attachment]),
  }).run();
  assert.equal(offline.status, "degraded");
  assert.equal(
    offline.checks.find((check) => check.id === "attachment:attachment-doctor")
      ?.status,
    "warn",
  );
});

test("Computer doctor fails safely when credential storage cannot be read", async () => {
  const doctor = new ComputerDoctor({
    attachmentStore: {
      read: async () => {
        throw new Error(`corrupt credential ${secret}`);
      },
    },
  });
  const report = await doctor.run();
  assert.equal(report.status, "degraded");
  assert.equal(report.checks[0]?.status, "fail");
  assert.ok(!JSON.stringify(report).includes(secret));
});
