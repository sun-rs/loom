import { runMacOSComputerInstallCommand } from "../packages/agent-host/src/index.ts";

try {
  process.stdout.write(
    await runMacOSComputerInstallCommand(process.argv.slice(2)),
  );
} catch (error) {
  process.stderr.write(
    `rah-os macOS Computer install failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}
