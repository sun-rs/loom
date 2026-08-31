import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { ActivationCredentialScope } from "@rah-os/protocol";

import { UnauthenticatedError } from "./errors.ts";
import { nullableText, text } from "./sqlite-row.ts";

const AUTHENTICATION_PROOF = Symbol("rah-os-authenticated-actor");
const issuedContexts = new WeakSet<object>();
const HOST_AUTHENTICATION_PROOF = Symbol("rah-os-authenticated-host");
const issuedHostContexts = new WeakSet<object>();
const WORKER_EXECUTION_PROOF = Symbol("rah-os-worker-execution");
const issuedWorkerExecutionContexts = new WeakSet<object>();

export class AuthenticatedActorContext {
  readonly credentialId: string;
  readonly principalId: string;

  constructor(principalId: string, credentialId: string, proof?: symbol) {
    if (proof !== AUTHENTICATION_PROOF) {
      throw new UnauthenticatedError("authentication context cannot be forged");
    }
    this.principalId = principalId;
    this.credentialId = credentialId;
    issuedContexts.add(this);
    Object.freeze(this);
  }
}

export function issueAuthenticatedActorContext(
  principalId: string,
  credentialId: string,
): AuthenticatedActorContext {
  return new AuthenticatedActorContext(
    principalId,
    credentialId,
    AUTHENTICATION_PROOF,
  );
}

export function isIssuedActorContext(
  value: unknown,
): value is AuthenticatedActorContext {
  return (
    typeof value === "object" && value !== null && issuedContexts.has(value)
  );
}

export class AuthenticatedHostContext {
  readonly credentialId: string;
  readonly hostId: string;
  readonly instanceId: string;
  readonly participantIds: readonly string[];

  constructor(
    hostId: string,
    participantIds: readonly string[],
    credentialId: string,
    instanceId: string,
    proof?: symbol,
  ) {
    if (proof !== HOST_AUTHENTICATION_PROOF) {
      throw new UnauthenticatedError(
        "host authentication context cannot be forged",
      );
    }
    this.hostId = hostId;
    this.instanceId = instanceId;
    this.participantIds = Object.freeze([...participantIds]);
    this.credentialId = credentialId;
    issuedHostContexts.add(this);
    Object.freeze(this);
  }
}

export function issueAuthenticatedHostContext(
  hostId: string,
  participantIds: readonly string[],
  credentialId: string,
  instanceId: string,
): AuthenticatedHostContext {
  return new AuthenticatedHostContext(
    hostId,
    participantIds,
    credentialId,
    instanceId,
    HOST_AUTHENTICATION_PROOF,
  );
}

export function isIssuedHostContext(
  value: unknown,
): value is AuthenticatedHostContext {
  return (
    typeof value === "object" && value !== null && issuedHostContexts.has(value)
  );
}

export class AuthenticatedWorkerExecutionContext {
  readonly hostCredentialId: string;
  readonly hostInstanceId: string;
  readonly scope: Readonly<ActivationCredentialScope>;

  constructor(
    hostCredentialId: string,
    hostInstanceId: string,
    scope: ActivationCredentialScope,
    proof?: symbol,
  ) {
    if (proof !== WORKER_EXECUTION_PROOF) {
      throw new UnauthenticatedError(
        "worker execution context cannot be forged",
      );
    }
    this.hostCredentialId = hostCredentialId;
    this.hostInstanceId = hostInstanceId;
    this.scope = Object.freeze({ ...scope });
    issuedWorkerExecutionContexts.add(this);
    Object.freeze(this);
  }
}

export function issueAuthenticatedWorkerExecutionContext(
  hostCredentialId: string,
  hostInstanceId: string,
  scope: ActivationCredentialScope,
): AuthenticatedWorkerExecutionContext {
  return new AuthenticatedWorkerExecutionContext(
    hostCredentialId,
    hostInstanceId,
    scope,
    WORKER_EXECUTION_PROOF,
  );
}

export function isIssuedWorkerExecutionContext(
  value: unknown,
): value is AuthenticatedWorkerExecutionContext {
  return (
    typeof value === "object" &&
    value !== null &&
    issuedWorkerExecutionContexts.has(value)
  );
}

export function requireAuthenticatedActor(
  database: DatabaseSync,
  actor: AuthenticatedActorContext,
): string {
  if (!isIssuedActorContext(actor)) {
    throw new UnauthenticatedError("authentication context is invalid");
  }
  const row = database
    .prepare(
      "SELECT 1 AS present FROM principal_credentials WHERE credential_id = ? AND principal_id = ? AND revoked_at IS NULL",
    )
    .get(actor.credentialId, actor.principalId);
  if (row === undefined) {
    throw new UnauthenticatedError("authentication context is invalid");
  }
  return actor.principalId;
}

export function requireAuthenticatedHostCredential(
  database: DatabaseSync,
  host: AuthenticatedHostContext,
): AuthenticatedHostContext {
  if (!isIssuedHostContext(host)) {
    throw new UnauthenticatedError("host authentication context is invalid");
  }
  const row = database
    .prepare(
      "SELECT host_id, participant_ids_json FROM agent_host_credentials WHERE credential_id = ? AND revoked_at IS NULL",
    )
    .get(host.credentialId);
  if (row === undefined || text(row, "host_id") !== host.hostId) {
    throw new UnauthenticatedError("host authentication context is invalid");
  }
  return host;
}

export function requireAuthenticatedHost(
  database: DatabaseSync,
  host: AuthenticatedHostContext,
): AuthenticatedHostContext {
  const authenticatedHost = requireAuthenticatedHostCredential(database, host);
  const row = database
    .prepare(
      "SELECT credential_id, instance_id, state FROM agent_hosts WHERE host_id = ?",
    )
    .get(authenticatedHost.hostId);
  if (
    row === undefined ||
    nullableText(row, "credential_id") !== authenticatedHost.credentialId ||
    text(row, "instance_id") !== authenticatedHost.instanceId ||
    text(row, "state") === "offline"
  ) {
    throw new UnauthenticatedError("Host daemon instance is not active");
  }
  return authenticatedHost;
}

export function createAccessToken(): string {
  return `rah_pat_${randomBytes(32).toString("base64url")}`;
}

export function createHostAccessToken(): string {
  return `rah_hat_${randomBytes(32).toString("base64url")}`;
}

export function hashAccessToken(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex");
}
