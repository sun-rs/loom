#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { formatDaemonBuildIdentity } from "./build-identity.ts";
import { DaemonConfigSchema } from "./config.ts";
import { DaemonApplication } from "./daemon-application.ts";
import { DAEMON_BUILD_IDENTITY } from "./daemon-health.ts";

const invocation = process.argv.slice(2);
if (invocation.length === 1 && invocation[0] === "--version") {
  process.stdout.write(
    `${formatDaemonBuildIdentity(DAEMON_BUILD_IDENTITY)} (${
      DAEMON_BUILD_IDENTITY.kind
    }, build ${DAEMON_BUILD_IDENTITY.buildId})\n`,
  );
  process.exit(0);
}
const configPath = parseConfigPath(invocation);
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
