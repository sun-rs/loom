#!/usr/bin/env node

import { runLocalCoreCommand } from "./local-core-cli-dispatch.ts";

process.exitCode = await runLocalCoreCommand(process.argv.slice(2));
