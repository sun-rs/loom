#!/usr/bin/env node

import { runNodeKCarrierComputerCommand } from "./computer-cli-dispatch.ts";

process.exitCode = await runNodeKCarrierComputerCommand(process.argv.slice(2));
