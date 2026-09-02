import type { AuthenticatedActorContext } from "@rah-os/kernel";
import {
  ClientComputerProfileUpdateRequestSchema,
  ClientComputerProfileUpdateResponseSchema,
  type ClientComputerProfileUpdateRequest,
  type ClientComputerProfileUpdateResponse,
} from "@rah-os/protocol";
import type { ZodType } from "zod";

export const COMPUTER_PROFILE_PATHS: readonly string[] = [
  "/computers/profile/update",
];

export type ComputerProfileAdministrationPort = Readonly<{
  update(
    actor: AuthenticatedActorContext,
    input: ClientComputerProfileUpdateRequest,
  ):
    | ClientComputerProfileUpdateResponse
    | Promise<ClientComputerProfileUpdateResponse>;
}>;

export async function routeComputerProfile(
  actor: AuthenticatedActorContext,
  body: Record<string, unknown>,
  port: ComputerProfileAdministrationPort | undefined,
  parse: <T>(schema: ZodType<T>, body: Record<string, unknown>) => T,
): Promise<ClientComputerProfileUpdateResponse> {
  if (port === undefined) {
    throw new Error("Computer profile administration is unavailable");
  }
  return ClientComputerProfileUpdateResponseSchema.parse(
    await port.update(
      actor,
      parse(ClientComputerProfileUpdateRequestSchema, body),
    ),
  );
}
