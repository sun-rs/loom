import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/room-kernel.ts";

test("revoked Host cannot reuse its formerly authenticated execution-binding reader", () => {
  const kernel = new RoomKernel({ databasePath: ":memory:" });
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      kind: "agent",
      handle: "binding-agent",
    });
    const credential = kernel.provisionHostCredential({
      hostId: "binding-host",
      participantIds: [agent.principal.principalId],
    });
    const host = kernel.authenticateHostAccessToken(credential.accessToken);
    kernel.heartbeatHost(host);
    assert.deepEqual(kernel.listHostExecutionWorkspaceBindings(host), []);
    kernel.revokeHostCredential(credential.credentialId);
    assert.throws(() => kernel.listHostExecutionWorkspaceBindings(host));
  } finally {
    kernel.close();
  }
});
