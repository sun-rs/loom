#!/usr/bin/env node

import { runNodeKCarrierComputerSupervisorCommand } from "./node-k-carrier-computer-supervisor-process.ts";

process.exitCode = await runNodeKCarrierComputerSupervisorCommand(
  process.argv.slice(2),
);
