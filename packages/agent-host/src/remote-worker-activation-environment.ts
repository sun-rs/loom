import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
import type { ActivationEnvelope } from "./runtime.ts";
import type { ComputerResidentService } from "./computer-resident-service.ts";
import { createWorkerToolTransportEnvironment } from "./worker-tool-transport.ts";

export type RemoteWorkerCredentialServicePort = Pick<
  ComputerResidentService,
  "issueWorkerCredential" | "revokeWorkerCredential"
>;

export async function issueRemoteWorkerActivationEnvironment(
  resident: RemoteWorkerCredentialServicePort,
  options: { credentialDirectory: string },
  input: ActivationEnvelope,
) {
  const credential = await resident.issueWorkerCredential({
    activationId: input.activationId,
    consumerId: input.consumerId,
    participantId: input.participantId,
    roomId: input.roomId,
    runAttemptId: input.runAttemptId,
    toSeq: input.toSeq,
  });
  const lease = await createWorkerToolTransportEnvironment({
    credentialDirectory: options.credentialDirectory,
    revokeCredential: async () => {
      await resident.revokeWorkerCredential({
        credentialId: credential.credentialId,
      });
    },
    workerAccessToken: credential.workerAccessToken,
    workerApiOrigin: credential.workerApiOrigin,
  });
  return Object.freeze({ credential, lease });
}

/**
 * Issues one activation-scoped Worker credential through the authenticated
 * Computer channel. The runtime receives only the canonical Worker API, never
 * the Host attachment or Computer session credential.
 */
export function createRemoteWorkerActivationEnvironment(
  resident: RemoteWorkerCredentialServicePort,
  options: { credentialDirectory: string },
): (input: ActivationEnvelope) => Promise<ActivationEnvironmentLease> {
  return async (input) => {
    return (
      await issueRemoteWorkerActivationEnvironment(resident, options, input)
    ).lease;
  };
}
