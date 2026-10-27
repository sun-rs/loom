import { claudeModelMatches } from "./claude-usage.mjs";
// Owner 2026-10-28: explicit current Kimi route, never an implicit expansion
// of the sonnet family. Leave installed connection configuration untouched.
export function claudeGateRoute(config, env = process.env) {
  const route = env.RAH_EFFICIENCY_CLAUDE_ROUTE;
  if (route === undefined) return undefined;
  if (
    route !== "kimi-code-cn/k3.1-pro[1m]" ||
    config.model !== "sonnet" ||
    config.effort !== "low"
  )
    throw new Error("Unapproved Claude route/model/effort combination");
  return route;
}
export function claudeGateModelMatches(config, actual, env = process.env) {
  const route = claudeGateRoute(config, env);
  if (route !== undefined)
    return actual === route || actual === "kimi-code-cn/k3.1-pro";
  return claudeModelMatches(config.model, actual);
}
