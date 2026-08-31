#!/usr/bin/env node

import { runWorkerCliCommand } from "./worker-cli.ts";

process.exitCode = await runWorkerCliCommand(process.argv.slice(2));
