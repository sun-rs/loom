import assert from "node:assert/strict";
import test from "node:test";
import { RahClientError } from "@rah-os/client-sdk";
import { describePushTestFailure } from "../../frontends/raft/loom/push-failure.ts";

test("push failures distinguish server rejection from lost responses without leaking provider secrets", () => {
  assert.match(
    describePushTestFailure(
      new RahClientError("unauthenticated", "secret", 401),
    ),
    /登录状态/,
  );
  assert.match(
    describePushTestFailure(
      new RahClientError("internal_error", "secret", 500),
    ),
    /HTTP 500/,
  );
  assert.match(
    describePushTestFailure(new TypeError("secret endpoint")),
    /网络连接/,
  );
  assert.match(
    describePushTestFailure(
      new RahClientError("invalid_response", "secret", 200),
    ),
    /响应格式/,
  );
  for (const error of [
    new Error("secret"),
    new RahClientError("secret", "secret", 500),
  ]) {
    const message = describePushTestFailure(error);
    assert.doesNotMatch(message, /secret/);
    assert.match(message, /未自动重发/);
  }
});

test("deadline explains unknown delivery rather than claiming a failed send", () => {
  const message = describePushTestFailure(
    new DOMException("deadline", "TimeoutError"),
  );
  assert.match(message, /20 秒/);
  assert.match(message, /稍后到达/);
  assert.match(message, /未自动重发/);
});
