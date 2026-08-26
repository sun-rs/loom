import { z } from "zod";

export const CLIENT_API_VERSION = 2 as const;

const ClientHealthBaseSchema = z.object({
  buildVersion: z.string().min(1),
  kernelSchemaVersion: z.number().int().positive(),
  protocolVersion: z.number().int().positive(),
  state: z.enum(["failed", "offline", "online", "starting"]),
});

export const ClientHealthV1ResponseSchema = ClientHealthBaseSchema.extend({
  apiVersion: z.literal(1),
  capabilities: z
    .object({
      cursorAcknowledge: z.boolean(),
      hints: z.boolean(),
      inputRequestRead: z.boolean(),
      inputRequestResolve: z.boolean(),
      roomSync: z.boolean(),
      taskRead: z.boolean(),
      taskWrite: z.boolean(),
    })
    .strict(),
}).strict();
export type ClientHealthV1Response = z.infer<
  typeof ClientHealthV1ResponseSchema
>;

export const ClientHealthResponseSchema = ClientHealthBaseSchema.extend({
  apiVersion: z.literal(CLIENT_API_VERSION),
  capabilities: z
    .object({
      cursorAcknowledge: z.boolean(),
      hints: z.boolean(),
      inputRequestRead: z.boolean(),
      inputRequestResolve: z.boolean(),
      memberRead: z.boolean(),
      memberWrite: z.boolean(),
      messageRead: z.boolean(),
      messageWrite: z.boolean(),
      roomRead: z.boolean(),
      roomSync: z.boolean(),
      taskRead: z.boolean(),
      taskWrite: z.boolean(),
      threadRead: z.boolean(),
      threadWrite: z.boolean(),
      workspaceRead: z.boolean(),
    })
    .strict(),
}).strict();
export type ClientHealthResponse = z.infer<typeof ClientHealthResponseSchema>;
