import test from "node:test";
import assert from "node:assert/strict";
import { claudeGateRoute, claudeGateModelMatches } from "./claude-route.mjs";
test("explicit owner-approved Kimi route does not weaken ordinary Claude family fences", () => {
  const config = { model: "sonnet", effort: "low" };
  assert.equal(claudeGateRoute(config, {}), undefined);
  assert.equal(
    claudeGateModelMatches(config, "kimi-code-cn/k3.1-pro", {}),
    false,
  );
  const env = { RAH_EFFICIENCY_CLAUDE_ROUTE: "kimi-code-cn/k3.1-pro[1m]" };
  assert.equal(claudeGateRoute(config, env), "kimi-code-cn/k3.1-pro[1m]");
  for (const model of [
    "k3.1-pro",
    "kimi-code-cn/k3.1-pro",
    "kimi-code-cn/k3.1-pro[1m]",
  ])
    assert.equal(claudeGateModelMatches(config, model, env), true);
  for (const model of ["claude-sonnet-5", "kimi-code-cn/k3", "sonnet"])
    assert.equal(claudeGateModelMatches(config, model, env), false);
  assert.throws(() => claudeGateRoute({ ...config, effort: "high" }, env));
  assert.throws(() => claudeGateRoute({ ...config, model: "haiku" }, env));
  assert.throws(() =>
    claudeGateRoute(config, { RAH_EFFICIENCY_CLAUDE_ROUTE: "other" }),
  );
});
