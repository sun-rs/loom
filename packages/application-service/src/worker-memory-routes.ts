import type { z } from "zod";
import type {
  AuthenticatedWorkerExecutionContext,
  RoomKernel,
} from "@rah-os/kernel";
import * as P from "@rah-os/protocol";

/**
 * evo S6 batch A: the Worker facade of channel memory. The Kernel derives the
 * channel, the switches and the provenance from the credential; these routes
 * only parse the strict request and shape the response. There is no delete
 * route: deleting memory is Human-only.
 */
export function handleWorkerMemoryRequest(
  kernel: RoomKernel,
  execution: AuthenticatedWorkerExecutionContext,
  route: string,
  body: Record<string, unknown>,
  parse: <T>(schema: z.ZodType<T>, body: Record<string, unknown>) => T,
): unknown {
  const memory = kernel.memory;
  switch (route) {
    case "/v1/worker/memory/write":
      return P.MemoryMutationResponseSchema.parse(
        memory.write(execution, parse(P.WorkerMemoryWriteRequestSchema, body)),
      );
    case "/v1/worker/memory/update":
      return P.MemoryMutationResponseSchema.parse(
        memory.update(
          execution,
          parse(P.WorkerMemoryUpdateRequestSchema, body),
        ),
      );
    case "/v1/worker/memory/invalidate":
      return P.MemoryMutationResponseSchema.parse(
        memory.invalidate(
          execution,
          parse(P.WorkerMemoryInvalidateRequestSchema, body),
        ),
      );
    case "/v1/worker/memory/restore":
      return P.MemoryMutationResponseSchema.parse(
        memory.restore(
          execution,
          parse(P.WorkerMemoryRestoreRequestSchema, body),
        ),
      );
    case "/v1/worker/memory/list":
      return P.MemoryListResponseSchema.parse(
        memory.list(execution, parse(P.WorkerMemoryListRequestSchema, body)),
      );
    case "/v1/worker/memory/read":
      return P.MemoryReadResponseSchema.parse(
        memory.read(execution, parse(P.WorkerMemoryReadRequestSchema, body)),
      );
    case "/v1/worker/memory/search":
      return P.MemorySearchResponseSchema.parse(
        memory.search(
          execution,
          parse(P.WorkerMemorySearchRequestSchema, body),
        ),
      );
    case "/v1/worker/memory/history":
      return P.MemoryHistoryResponseSchema.parse(
        memory.history(
          execution,
          parse(P.WorkerMemoryHistoryRequestSchema, body),
        ),
      );
    default:
      return undefined;
  }
}
