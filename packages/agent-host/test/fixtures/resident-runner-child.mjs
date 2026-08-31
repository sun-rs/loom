const mode = process.env.RAH_RESIDENT_FIXTURE_MODE;
const processGeneration = Number(process.env.RAH_RESIDENT_PROCESS_GENERATION);

if (!Number.isSafeInteger(processGeneration) || processGeneration <= 0) {
  throw new Error("RAH_RESIDENT_PROCESS_GENERATION is required");
}

process.on("SIGTERM", () => process.exit(0));

if (mode === "connected") {
  process.send?.({
    kind: "resident-runner-connected",
    processGeneration,
  });
} else if (mode === "configuration") {
  process.send?.({
    kind: "resident-runner-terminal",
    processGeneration,
    reason: "configuration",
  });
  setTimeout(() => process.exit(78), 10);
} else if (mode === "diagnostic-only") {
  process.stdout.write("connected\n");
} else if (mode === "environment-proof") {
  if (
    process.env.RAH_RESIDENT_RUNNER_CONFIG !== undefined ||
    process.env.RAH_RESIDENT_RUNNER_TOKEN !== undefined
  ) {
    process.send?.({
      kind: "resident-runner-terminal",
      processGeneration,
      reason: "configuration",
    });
    setTimeout(() => process.exit(78), 10);
  } else {
    process.send?.({
      kind: "resident-runner-connected",
      processGeneration,
    });
  }
}

setInterval(() => undefined, 1_000);
