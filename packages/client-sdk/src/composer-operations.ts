import * as P from "@rah-os/protocol";
import type { z } from "zod";

export const composerOperations = {
  "computer.files.list": {
    input: P.ComputerFilesListRequestSchema,
    output: P.ComputerFilesListResponseSchema,
    path: "/v3/client/computers/files/list",
    method: "POST",
    authenticated: true,
  },
  "room.execution.read": {
    input: P.RoomExecutionReadRequestSchema,
    output: P.RoomExecutionReadResponseSchema,
    path: "/v3/client/rooms/sos/read",
    method: "POST",
    authenticated: true,
  },
} as const;
export type ComposerOperationMap = {
  [K in keyof typeof composerOperations]: {
    input: z.infer<(typeof composerOperations)[K]["input"]>;
    output: z.infer<(typeof composerOperations)[K]["output"]>;
  };
};
