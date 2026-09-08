import * as P from "@rah-os/protocol";

/** Trusted synchronous Host projection. Kernel chooses identifiers after Room ACL. */
export type WorkerProfileMetadataPort = {
  computer(hostId: string): P.WorkerComputerPublicMetadata | undefined;
  runtime(target: {
    hostId: string;
    runtimeProfileId: string;
    runtimeProfileRevisionId: string;
  }): P.WorkerRuntimePublicMetadata | undefined;
};
export function publicComputerMetadata(
  port: WorkerProfileMetadataPort | undefined,
  hostId: string,
) {
  const value = port?.computer(hostId);
  if (value === undefined) return {};
  const parsed = P.WorkerComputerPublicMetadataSchema.parse(value);
  return parsed.hostId === hostId ? parsed : {};
}
export function publicRuntimeMetadata(
  port: WorkerProfileMetadataPort | undefined,
  target: {
    hostId: string;
    runtimeProfileId: string;
    runtimeProfileRevisionId: string;
  },
) {
  const value = port?.runtime(target);
  if (value === undefined) return undefined;
  const parsed = P.WorkerRuntimePublicMetadataSchema.parse(value);
  return parsed.hostId === target.hostId &&
    parsed.runtimeProfileId === target.runtimeProfileId &&
    parsed.runtimeProfileRevisionId === target.runtimeProfileRevisionId
    ? parsed
    : undefined;
}
