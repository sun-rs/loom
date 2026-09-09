import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const registryPath = "docs/product/raft-parity-registry.json";
export const cliPath = "packages/agent-host/src/worker-cli.ts";
export const routePath =
  "packages/application-service/src/worker-application-service.ts";
export const readRoutePath =
  "packages/application-service/src/worker-read-handler.ts";
export const promptPath = "packages/daemon/src/standing-prompt-compiler.ts";

const KINDS = ["cli", "route", "prompt-paragraph"];
const VERDICTS = ["aligned", "justified", "unjustified", "missing"];
const CONSTRAINTS = [
  "no-central-server",
  "local-credentials",
  "sqlite-ledger",
  "activation-fence",
  "single-machine",
  "deferred-scope",
];

// Every Agent-facing CLI command: the help() catalogue plus every switch label.
// The two are unioned so neither an undocumented case nor an unimplemented help
// line can hide a surface from the registry.
export function parseWorkerCliCommands(source) {
  const commands = new Set();
  const start = source.indexOf("function help()");
  const body =
    start === -1
      ? ""
      : source
          .slice(start, source.indexOf("`;", start))
          .split("`")
          .slice(1)
          .join("`");
  for (const line of body.split("\n")) {
    const inbox = /^rah agent inbox ([a-z0-9-]+)/u.exec(line);
    if (inbox) {
      commands.add(`agent inbox ${inbox[1]}`);
      continue;
    }
    const named = /^rah (app|reminder|worker) ([a-z0-9|-]+)(?: |$)/u.exec(line);
    if (!named) continue;
    for (const sub of named[2].split("|")) commands.add(`${named[1]} ${sub}`);
  }
  for (const [, label] of source.matchAll(/case "([a-z0-9-]+)":/gu))
    commands.add(`worker ${label}`);
  return [...commands].sort();
}

// The worker route table, with the read-handler table spliced in where the
// service spreads it.
export function parseWorkerRoutes(serviceSource, readSource) {
  const literals = (source, name) => {
    const start = source.indexOf(`${name} = [`);
    if (start === -1) return [];
    const block = source.slice(start, source.indexOf("] as const", start));
    return block.split("\n");
  };
  const readRoutes = literals(readSource, "WORKER_READ_ROUTE_PATHS")
    .map((line) => /"([^"]+)"/u.exec(line)?.[1])
    .filter((value) => typeof value === "string");
  const routes = [];
  for (const line of literals(serviceSource, "WORKER_HTTP_ROUTE_PATHS")) {
    if (line.includes("...WORKER_READ_ROUTE_PATHS")) {
      routes.push(...readRoutes);
      continue;
    }
    const literal = /"([^"]+)"/u.exec(line)?.[1];
    if (literal) routes.push(literal);
  }
  return [...new Set(routes)].sort();
}

function regionDigest(fd, offset, bytes) {
  const buffer = Buffer.alloc(bytes);
  const read = readSync(fd, buffer, 0, bytes, offset);
  return createHash("sha256").update(buffer.subarray(0, read)).digest("hex");
}

// Offline validation only. A pinned region digest proves the extraction has not
// moved, never that RAH matches Raft.
export function validateRegistry(registry, read, options = {}) {
  const errors = [];
  const notices = [];
  const safeRead = (path, label) => {
    try {
      return read(path).toString();
    } catch {
      errors.push(`${label}: missing ${path}`);
      return undefined;
    }
  };
  if (registry.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (
    JSON.stringify(registry.constraints ?? []) !== JSON.stringify(CONSTRAINTS)
  )
    errors.push("constraint enum drift; the closed enum may not be extended");

  const seen = new Set();
  for (const entry of registry.entries) {
    const id = entry.id;
    if (!id || seen.has(id)) errors.push(`duplicate or empty entry id: ${id}`);
    seen.add(id);
    if (!KINDS.includes(entry.kind)) errors.push(`${id}: invalid kind`);
    if (!VERDICTS.includes(entry.verdict))
      errors.push(`${id}: invalid verdict`);
    if (
      entry.constraint !== undefined &&
      !CONSTRAINTS.includes(entry.constraint)
    )
      errors.push(
        `${id}: constraint "${entry.constraint}" is not one of ${CONSTRAINTS.join(", ")}`,
      );
    const deferredMissing =
      entry.verdict === "missing" && entry.deferred === true;
    if (entry.verdict === "justified" || deferredMissing) {
      if (!entry.constraint)
        errors.push(
          `${id}: ${entry.verdict === "justified" ? "justified" : "deferred missing"} entry requires a constraint from ${CONSTRAINTS.join(", ")}`,
        );
      if (typeof entry.note !== "string" || entry.note.trim() === "")
        errors.push(`${id}: declared divergence requires a non-empty note`);
    }
    if (entry.verdict === "missing" && entry.rah)
      errors.push(`${id}: a missing surface cannot name a RAH owner`);
    // A justified entry may be an absence RAH deliberately did not port, so it
    // is the only verdict other than `missing` allowed to name no RAH owner.
    if (["aligned", "unjustified"].includes(entry.verdict) && !entry.rah)
      errors.push(`${id}: ${entry.verdict} entry requires a RAH owner`);
    if (entry.verdict === "justified" && !entry.raft && !entry.rah)
      errors.push(`${id}: justified entry requires a RAH or a Raft anchor`);
    if (entry.rah?.file) safeRead(entry.rah.file, `${id}: owner`);
  }

  const cliSource = safeRead(cliPath, "cli source");
  const routeSource = safeRead(routePath, "route source");
  const readRouteSource = safeRead(readRoutePath, "read route source");
  const registered = (kind) =>
    new Set(
      registry.entries
        .filter((entry) => entry.kind === kind && entry.rah?.symbol)
        .map((entry) => entry.rah.symbol),
    );

  const commands = cliSource ? parseWorkerCliCommands(cliSource) : [];
  const registeredCommands = registered("cli");
  for (const command of commands)
    if (!registeredCommands.has(command))
      errors.push(`undeclared agent-facing surface: rah ${command}`);
  for (const command of registeredCommands)
    if (cliSource && !commands.includes(command))
      errors.push(
        `registered surface no longer exists: rah ${command}; retire its registry entry`,
      );

  const routes =
    routeSource && readRouteSource
      ? parseWorkerRoutes(routeSource, readRouteSource)
      : [];
  const registeredRoutes = registered("route");
  for (const route of routes)
    if (!registeredRoutes.has(route))
      errors.push(`undeclared agent-facing surface: ${route}`);
  for (const route of registeredRoutes)
    if (routes.length && !routes.includes(route))
      errors.push(
        `registered surface no longer exists: ${route}; retire its registry entry`,
      );

  const counts = {
    unjustified: registry.entries.filter(
      (entry) => entry.verdict === "unjustified",
    ).length,
    missingNonDeferred: registry.entries.filter(
      (entry) => entry.verdict === "missing" && entry.deferred !== true,
    ).length,
  };
  const ratchet = registry.ratchet ?? {};
  if (counts.unjustified > (ratchet.unjustified ?? 0))
    errors.push(
      `unjustified divergences rose to ${counts.unjustified}; replicate the Raft contract instead of raising the ${ratchet.unjustified} ratchet`,
    );
  if (counts.missingNonDeferred > (ratchet.missingNonDeferred ?? 0))
    errors.push(
      `non-deferred missing surfaces rose to ${counts.missingNonDeferred}; port the Raft surface instead of raising the ${ratchet.missingNonDeferred} ratchet`,
    );

  const promptSource = safeRead(promptPath, "prompt source");
  const judgment = registry.entries.filter(
    (entry) =>
      entry.kind === "prompt-paragraph" && entry.classification === "judgment",
  );
  for (const entry of judgment)
    if (!entry.rah?.needles?.length)
      errors.push(
        `${entry.id}: judgment paragraph requires identifying needles`,
      );
  const judgmentPresent = promptSource
    ? judgment.filter((entry) =>
        (entry.rah?.needles ?? []).every((needle) =>
          promptSource.includes(needle),
        ),
      ).length
    : judgment.length;
  const judgmentRatchet = ratchet.promptJudgmentParagraphs ?? 0;
  if (judgmentPresent > judgmentRatchet)
    errors.push(
      `standing prompt judgment paragraphs rose to ${judgmentPresent}; remove the paragraph instead of raising the ${judgmentRatchet} ratchet`,
    );

  const upstreamPath = registry.upstream?.path;
  let fd;
  try {
    fd = options.openUpstream
      ? options.openUpstream(upstreamPath)
      : openSync(upstreamPath, "r");
  } catch {
    fd = undefined;
  }
  let anchorsChecked = 0;
  if (fd === undefined)
    notices.push(
      "upstream extraction not available; anchor verification skipped",
    );
  else {
    try {
      for (const entry of registry.entries) {
        const region = entry.raft?.region;
        if (!region) continue;
        anchorsChecked += 1;
        if (regionDigest(fd, region.offset, region.bytes) !== region.sha256)
          errors.push(
            `${entry.id}: upstream anchor drift at ${entry.raft.location}`,
          );
      }
    } finally {
      if (!options.openUpstream) closeSync(fd);
    }
  }

  return { anchorsChecked, counts, errors, judgmentPresent, notices };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const result = validateRegistry(registry, (path) => readFileSync(path));
  for (const notice of result.notices) console.log(notice);
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      [
        `Raft parity registry valid: ${registry.entries.length} entries`,
        `unjustified ${result.counts.unjustified}/${registry.ratchet.unjustified}`,
        `non-deferred missing ${result.counts.missingNonDeferred}/${registry.ratchet.missingNonDeferred}`,
        `standing prompt judgment paragraphs ${result.judgmentPresent}/${registry.ratchet.promptJudgmentParagraphs}`,
        `upstream anchors verified ${result.anchorsChecked}`,
      ].join("; "),
    );
}
