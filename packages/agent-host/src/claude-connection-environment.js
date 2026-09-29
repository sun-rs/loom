import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Read only connection data, never execute apiKeyHelper or enable user settings.
// Keep endpoint and credentials together: an explicit launch connection wins as
// a unit so a personal token is not paired with an unrelated launch endpoint.
const CONNECTION_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
];
const AUTH_SOURCE_KEYS = [...CONNECTION_KEYS, "CLAUDE_CODE_OAUTH_TOKEN"];
const ALIAS_KEYS = [
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
];

export function claudeConnectionEnvironment(environment) {
  const next = { ...environment };
  const directory =
    environment.CLAUDE_CONFIG_DIR ||
    join(environment.HOME || homedir(), ".claude");
  let settings;
  try {
    settings = JSON.parse(
      readFileSync(join(directory, "settings.json"), "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return next;
    // JSON and I/O errors can contain paths or source text with credentials.
    throw new Error(
      "Claude user connection settings could not be read; check settings.json",
    );
  }
  const env = settings?.env;
  if (env === undefined) return next;
  if (env === null || typeof env !== "object" || Array.isArray(env))
    throw new Error("Claude user connection settings env must be an object");
  const keys = AUTH_SOURCE_KEYS.some((key) => environment[key] !== undefined)
    ? ALIAS_KEYS
    : [...CONNECTION_KEYS, ...ALIAS_KEYS];
  for (const key of keys) {
    if (environment[key] !== undefined || !Object.hasOwn(env, key)) continue;
    if (typeof env[key] !== "string" || env[key].includes("\0"))
      throw new Error(
        `Claude connection setting ${key} must be a string without NUL`,
      );
    next[key] = env[key];
  }
  return next;
}
