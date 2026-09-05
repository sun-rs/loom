import path from "node:path";

import { resolveRahDataHome } from "../packages/runtime-daemon/src/rah-paths.mjs";
import { runRoomCursorMaintenance } from "../packages/runtime-daemon/src/room/room-runtime";

function parseArgs(argv: string[]): {
  operation: "status" | "rotate" | "recover";
  expectedGeneration?: string;
} {
  const operation = argv.shift();
  if (operation !== "status" && operation !== "rotate" && operation !== "recover") {
    throw new Error("Room cursor maintenance requires status, rotate, or recover");
  }
  let expectedGeneration: string | undefined;
  while (argv.length > 0) {
    const option = argv.shift();
    if (option !== "--expected-generation" || expectedGeneration !== undefined) {
      throw new Error(`Unknown Room cursor maintenance argument: ${option ?? "<missing>"}`);
    }
    expectedGeneration = argv.shift();
    if (!expectedGeneration) throw new Error("Expected Room cursor generation is missing");
  }
  if (operation === "status" && expectedGeneration) {
    throw new Error("Room cursor status does not accept an expected generation");
  }
  if (operation !== "status" && !expectedGeneration) {
    throw new Error(`Room cursor ${operation} requires an expected generation`);
  }
  return { operation, ...(expectedGeneration ? { expectedGeneration } : {}) };
}

const args = parseArgs(process.argv.slice(2));
const result = await runRoomCursorMaintenance({
  roomRoot: path.join(resolveRahDataHome(), "room"),
  operation: args.operation,
  ...(args.expectedGeneration ? { expectedGeneration: args.expectedGeneration } : {}),
});
process.stdout.write(`Room cursor ${args.operation}: ${result.generation}\n`);
