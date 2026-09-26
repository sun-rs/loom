import { delimiter } from "node:path";

import {
  LEGACY_RAH_WORKER_TOKEN_ENV,
  LEGACY_RAH_WORKER_TOKEN_FILE_ENV,
  RAH_AGENT_TOOL_BIN_ENV,
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_CLI_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
} from "./worker-credential-file.ts";
import {
  RAH_AGENT_APP_INBOX_JSON_ENV,
  RAH_AGENT_MEMORY_DIR_ENV,
  RAH_AGENT_MEMORY_INDEX_ENV,
} from "./agent-memory-workspace.ts";
import { RAH_AGENT_MEMORY_BOOTSTRAP_JSON_ENV } from "./agent-memory-bootstrap.ts";
import { RAH_AGENT_MEMORY_SOURCE_FILE_ENV } from "./agent-memory-project.ts";

/**
 * Environment hygiene for Provider child processes.
 *
 * This is not an OS sandbox. The Provider CLI still runs as the same macOS
 * user, with the user's HOME and login directories, and can read whatever that
 * user can read. The policy only decides which values RAH OS itself hands to
 * the child, so RAH service credentials, internal transports and deployment
 * locations are not delivered by inheritance, and so a user's per-Agent
 * override cannot re-inject the platform identity fence.
 */

/**
 * The daemon owns the whole `RAH_` namespace. Nothing a Provider child needs
 * arrives by inheriting it: Activation identity is re-applied as a fence, and
 * Worker/memory capability arrives through the Activation environment lease.
 */
export const INHERITED_INTERNAL_ENVIRONMENT_PREFIXES: readonly string[] = [
  "RAH_",
];

/**
 * Capability carriers that must never reach a child from an untrusted layer
 * (inherited daemon environment or static Runtime configuration). Legitimate
 * values for these names come from the Activation environment lease only.
 */
export const MANAGED_CARRIER_ENVIRONMENT_KEYS: readonly string[] = [
  LEGACY_RAH_WORKER_TOKEN_ENV,
  LEGACY_RAH_WORKER_TOKEN_FILE_ENV,
  RAH_AGENT_APP_INBOX_JSON_ENV,
  RAH_AGENT_MEMORY_BOOTSTRAP_JSON_ENV,
  RAH_AGENT_MEMORY_DIR_ENV,
  RAH_AGENT_MEMORY_INDEX_ENV,
  "RAH_AGENT_MEMORY_SYSTEM_SHA256",
  RAH_AGENT_MEMORY_SOURCE_FILE_ENV,
  RAH_AGENT_TOOL_BIN_ENV,
  RAH_WORKER_API_URL_ENV,
  RAH_WORKER_CLI_ENV,
  RAH_WORKER_SESSION_FILE_ENV,
  // S2-a: a warm runtime's non-listable turn root; only the Host sets it.
  "RAH_WORKER_TURN_ROOT",
  // P2-3: the protocol-update wake line; only the Host's lease sets it.
  "RAH_PROTOCOL_NOTICE",
  "RAH_AGENT_CONTEXT_JSON",
  "RAH_AGENT_INBOX_API_URL",
  "RAH_AGENT_INBOX_CLI",
  "RAH_AGENT_INBOX_SESSION_FILE",
  "RAH_CONTEXT_MANIFEST_JSON",
  "RAH_PROVIDER_LAUNCH_ARGS_JSON",
  "RAH_REQUIRE_SESSION_CONTINUITY",
];

/**
 * Activation identity the AgentHost applies last. No inherited value, static
 * Runtime configuration, Activation lease or user override may change it.
 */
export const ACTIVATION_IDENTITY_FENCE_KEYS: readonly string[] = [
  "RAH_ACTIVATION_ID",
  "RAH_ACTIVATION_REASON",
  "RAH_AGENT_CONTEXT_JSON",
  "RAH_CONSUMER_ID",
  "RAH_CONTEXT_MANIFEST_JSON",
  "RAH_FROM_SEQ",
  "RAH_HOST_ID",
  "RAH_PARTICIPANT_ID",
  "RAH_ROOM_ID",
  "RAH_RUN_ATTEMPT_ID",
  "RAH_TO_SEQ",
  // S2-0 leftover-process tags. Every descendant inherits them, so the Host
  // can find processes that escaped the run's process group after it ends.
  "LOOM_RUNTIME_ID",
  "LOOM_RUN_ID",
  "RAH_RUNTIME_NOTICE",
];

/**
 * Keys a user's per-Agent Runtime configuration may never set. It mirrors the
 * typed boundary in `RuntimeLaunchEnvironmentSchema`; this function is the
 * runtime-side owner so a stored or replayed override cannot bypass it.
 */
export const USER_OVERRIDE_PROTECTED_KEYS: readonly string[] = [
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "HOME",
  // evo §40 B1: kimi-code 0.39.1 cron scheduler and in-turn WaitFor switches.
  "KIMI_CODE_EXPERIMENTAL_WAIT_FOR",
  "KIMI_DISABLE_CRON",
  "KIMI_MODEL_THINKING_EFFORT",
  "NODE_OPTIONS",
  "NODE_PATH",
  // evo §40 B1: OpenCode 1.18.32 merges it into the config permission.
  "OPENCODE_PERMISSION",
  "PATH",
  "SHELL",
  "USER",
];

export const USER_OVERRIDE_PROTECTED_PREFIXES: readonly string[] = [
  "DYLD_",
  "LD_",
  "LOOM_",
  "RAH_",
];

function hasPrefix(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix));
}

/**
 * Strip RAH-internal service credentials, internal transports and deployment
 * locations from an inherited process environment. Everything outside the RAH
 * namespace is preserved: HOME, PATH, Provider login/configuration
 * directories, proxy and certificate settings, locale and TERM.
 */
export function sanitizeInheritedEnvironment(
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined) continue;
    if (hasPrefix(key, INHERITED_INTERNAL_ENVIRONMENT_PREFIXES)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Drop the keys a user's per-Agent Runtime configuration may not set. The
 * result is the subset RAH OS will forward; `rejected` names what was refused
 * so a caller can report it instead of silently applying a partial override.
 */
export function filterUserLaunchEnvironment(
  environment: Readonly<Record<string, string>>,
): {
  environment: Record<string, string>;
  rejected: string[];
} {
  const accepted: Record<string, string> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(environment)) {
    if (
      USER_OVERRIDE_PROTECTED_KEYS.includes(key) ||
      hasPrefix(key, USER_OVERRIDE_PROTECTED_PREFIXES)
    ) {
      rejected.push(key);
      continue;
    }
    accepted[key] = value;
  }
  return { environment: accepted, rejected: rejected.sort() };
}

export type ActivationEnvironmentPolicyInput = {
  /** Static Runtime configuration owned by the daemon. */
  configured: Readonly<Record<string, string>>;
  /** Activation identity applied last; nothing may override it. */
  fences: Readonly<Record<string, string>>;
  /** The daemon's own process environment. */
  inherited: NodeJS.ProcessEnv;
  /** Activation environment lease: the controlled capability carrier. */
  leased?: Readonly<Record<string, string>>;
};

/**
 * Single owner of the environment every Provider child receives. Both the
 * direct and the supervised launch path call it with the same input, so the
 * two paths deliver the same filtered environment.
 */
export function resolveActivationEnvironment(
  input: ActivationEnvironmentPolicyInput,
): NodeJS.ProcessEnv {
  const untrusted: NodeJS.ProcessEnv = {
    ...sanitizeInheritedEnvironment(input.inherited),
    ...input.configured,
  };
  for (const key of MANAGED_CARRIER_ENVIRONMENT_KEYS) delete untrusted[key];

  const environment: NodeJS.ProcessEnv = {
    ...untrusted,
    ...input.leased,
  };
  // A fence absent from this Activation (e.g. no cleanup notice) must not
  // survive from an untrusted layer either.
  for (const key of ACTIVATION_IDENTITY_FENCE_KEYS) delete environment[key];
  Object.assign(environment, input.fences);
  delete environment[LEGACY_RAH_WORKER_TOKEN_ENV];

  const toolDirectory = environment[RAH_AGENT_TOOL_BIN_ENV];
  delete environment[RAH_AGENT_TOOL_BIN_ENV];
  if (toolDirectory !== undefined) {
    environment.PATH = `${toolDirectory}${delimiter}${environment.PATH ?? ""}`;
  }
  return environment;
}
