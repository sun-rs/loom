import assert from "node:assert/strict";
import test from "node:test";
import { combineActivationEnvironmentLeases } from "../src/activation-environment-lease.ts";

test("prompt compatibility survives composition without entering the child environment", () => {
  const lease = combineActivationEnvironmentLeases(
    [
      {
        env: {},
        standingPromptDigest: "new",
        compatibleStandingPromptDigest: "old",
      },
      { env: { WORKER: "fixture" } },
    ],
    "fixture",
  );
  assert.equal(lease.standingPromptDigest, "new");
  assert.equal(lease.compatibleStandingPromptDigest, "old");
  assert.deepEqual(lease.env, { WORKER: "fixture" });
});

test("compatibility cannot appear without its owning prompt or conflict across leases", () => {
  assert.throws(
    () =>
      combineActivationEnvironmentLeases(
        [
          { env: {}, compatibleStandingPromptDigest: "old" },
          { env: {}, standingPromptDigest: "new" },
        ],
        "fixture",
      ),
    /requires its current prompt/,
  );
  assert.throws(
    () =>
      combineActivationEnvironmentLeases(
        [
          {
            env: {},
            standingPromptDigest: "new",
            compatibleStandingPromptDigest: "old-a",
          },
          {
            env: {},
            standingPromptDigest: "new",
            compatibleStandingPromptDigest: "old-b",
          },
        ],
        "fixture",
      ),
    /conflicting compatible/,
  );
});
