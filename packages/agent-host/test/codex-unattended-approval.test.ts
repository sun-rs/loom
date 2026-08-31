import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexApprovalPolicyError,
  CodexUnattendedApprovalPolicy,
} from "../src/codex-unattended-approval.js";

const activeTurn = { threadId: "thread-1", turnId: "turn-1" };

test("Codex unattended approvals are full-access but bound to one active turn", () => {
  const policy = new CodexUnattendedApprovalPolicy();
  assert.deepEqual(
    policy.decide(
      {
        id: 1,
        method: "item/commandExecution/requestApproval",
        params: { ...activeTurn, itemId: "command-1" },
      },
      activeTurn,
    ),
    { duplicate: false, result: { decision: "accept" } },
  );
  assert.deepEqual(
    policy.decide(
      {
        id: 2,
        method: "item/permissions/requestApproval",
        params: {
          ...activeTurn,
          permissions: {
            fileSystem: { read: ["/workspace"], write: ["/workspace"] },
            futurePermission: { enabled: true },
            network: { enabled: true },
          },
        },
      },
      activeTurn,
    ),
    {
      duplicate: false,
      result: {
        permissions: {
          fileSystem: { read: ["/workspace"], write: ["/workspace"] },
          network: { enabled: true },
        },
        scope: "turn",
      },
    },
  );
});

test("Codex unattended approvals reject foreign identity and conflicting replay", () => {
  const policy = new CodexUnattendedApprovalPolicy();
  const foreign = {
    id: 7,
    method: "item/fileChange/requestApproval",
    params: { threadId: "foreign", turnId: "turn-1" },
  };
  assert.throws(
    () => policy.decide(foreign, activeTurn),
    (error) =>
      error instanceof CodexApprovalPolicyError &&
      error.code === -32602 &&
      /does not belong to the active Codex turn/u.test(error.message),
  );

  const valid = {
    id: 8,
    method: "item/fileChange/requestApproval",
    params: activeTurn,
  };
  assert.deepEqual(policy.decide(valid, activeTurn), {
    duplicate: false,
    result: { decision: "accept" },
  });
  assert.deepEqual(policy.decide(valid, activeTurn), { duplicate: true });
  assert.throws(
    () =>
      policy.decide(
        { ...valid, params: { ...activeTurn, itemId: "changed" } },
        activeTurn,
      ),
    (error) =>
      error instanceof CodexApprovalPolicyError &&
      error.code === -32602 &&
      /reused a consumed JSON-RPC id/u.test(error.message),
  );
});

test("Codex unattended approvals stop granting access once cancellation starts", () => {
  const policy = new CodexUnattendedApprovalPolicy();
  assert.deepEqual(
    policy.decide(
      {
        id: 20,
        method: "item/commandExecution/requestApproval",
        params: { ...activeTurn, itemId: "command-after-cancel" },
      },
      activeTurn,
      true,
    ),
    { duplicate: false, result: { decision: "cancel" } },
  );
  assert.deepEqual(
    policy.decide(
      {
        id: 21,
        method: "item/fileChange/requestApproval",
        params: { ...activeTurn, itemId: "patch-after-cancel" },
      },
      activeTurn,
      true,
    ),
    { duplicate: false, result: { decision: "cancel" } },
  );
  assert.throws(
    () =>
      policy.decide(
        {
          id: 22,
          method: "item/permissions/requestApproval",
          params: {
            ...activeTurn,
            permissions: { network: { enabled: true } },
          },
        },
        activeTurn,
        true,
      ),
    (error) =>
      error instanceof CodexApprovalPolicyError &&
      error.code === -32800 &&
      /turn was interrupted/u.test(error.message),
  );
});
