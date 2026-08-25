#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DaemonConfigSchema } from "./config.ts";
import { DaemonApplication } from "./daemon-application.ts";

const configPath = parseConfigPath(process.argv.slice(2));
const configValue: unknown = JSON.parse(await readFile(configPath, "utf8"));
const application = new DaemonApplication({
  config: DaemonConfigSchema.parse(configValue),
});
const shutdown = new AbortController();
const onInterrupt = () => shutdown.abort("SIGINT");
const onTerminate = () => shutdown.abort("SIGTERM");
process.once("SIGINT", onInterrupt);
process.once("SIGTERM", onTerminate);
try {
  await application.run({ signal: shutdown.signal });
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
}

function parseConfigPath(arguments_: string[]): string {
  if (arguments_.length !== 2 || arguments_[0] !== "--config") {
    throw new Error("usage: rah-os-daemon --config /absolute/path/config.json");
  }
  const value = arguments_[1];
  if (value === undefined) throw new Error("config path is required");
  return resolve(value);
}
