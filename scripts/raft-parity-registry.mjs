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
/** The standing prompt's protocol sections, compiled into it verbatim. */
export const promptProtocolPath =
  "packages/agent-host/src/standing-protocol.ts";

const KINDS = [
  "cli",
  "route",
  "prompt-paragraph",
  "output",
  "error-code",
  "output-format",
];
// The three tables of the output/error inventory. They are one surface: what
// the Agent process can actually observe — stdout bytes, stderr bytes, the exit
// code and the machine-parsable payload — so they share one pair of ratchets.
const OUTPUT_KINDS = new Set(["output", "error-code", "output-format"]);
const STREAMS = ["stdout", "stderr", "stdout+stderr", "none"];
// Upstream's own rule, from `renderError` and `writeText`/`writeJson`: a
// rendered result is written to stdout and a raised error to stderr. A row that
// is neither — a notice written beside a normal result — must say so.
const DISPOSITIONS = ["rendered-result", "raised-error", "side-channel"];
const DISPOSITION_STREAM = {
  "raised-error": "stderr",
  "rendered-result": "stdout",
};
const FORMATS = ["text", "json", "text+json-flag", "none"];
const OUTPUT_MODES = ["text", "json"];
const VERDICTS = [
  "aligned",
  "justified",
  "unjustified",
  "undecidable",
  "missing",
];
// What the row's "what Raft does" claim rests on. The authorized extraction is
// the Raft Computer; Raft's Server is closed and absent, so a claim that needs
// Server behaviour is not adjudicable in either direction and may only be
// `undecidable`.
const EVIDENCE = ["client-contract", "cli-behavior", "server-inferred"];
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
    const inbox = /^(?:rah|"\$RAH_WORKER_CLI") agent inbox ([a-z0-9-]+)/u.exec(
      line,
    );
    if (inbox) {
      commands.add(`agent inbox ${inbox[1]}`);
      continue;
    }
    // Help lines spell the absolute `"$RAH_WORKER_CLI"` path (2026-09-29):
    // a legacy `/opt/homebrew/bin/rah` shadows a bare `rah` in login shells.
    const named =
      /^(?:rah|"\$RAH_WORKER_CLI") (app|reminder|worker) ([a-z0-9|-]+)(?: |$)/u.exec(
        line,
      );
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

// An output row records both sides of one Agent-visible outcome: which stream
// carries it, the exit code, and whether the default rendering is text or JSON.
function validateOutputRow(entry, errors) {
  const id = entry.id;
  const streams = entry.streams ?? {};
  const format = entry.format ?? {};
  const exit = entry.exit ?? {};
  if (!DISPOSITIONS.includes(entry.disposition))
    errors.push(`${id}: disposition must be one of ${DISPOSITIONS.join(", ")}`);
  if (!STREAMS.includes(streams.raft))
    errors.push(`${id}: streams.raft must be one of ${STREAMS.join(", ")}`);
  if (streams.rah !== null && !STREAMS.includes(streams.rah))
    errors.push(
      `${id}: streams.rah must be null or one of ${STREAMS.join(", ")}`,
    );
  if (!FORMATS.includes(format.raft))
    errors.push(`${id}: format.raft must be one of ${FORMATS.join(", ")}`);
  if (format.rah !== null && !FORMATS.includes(format.rah))
    errors.push(
      `${id}: format.rah must be null or one of ${FORMATS.join(", ")}`,
    );
  for (const side of ["raft", "rah"])
    if (exit[side] !== null && !Number.isInteger(exit[side]))
      errors.push(`${id}: exit.${side} must be an integer or null`);
  // Upstream's rule, encoded rather than assumed.
  const required = DISPOSITION_STREAM[entry.disposition];
  if (required !== undefined && streams.raft !== required)
    errors.push(
      `${id}: a ${entry.disposition} is written to ${required} upstream, but this row records Raft writing ${streams.raft}; correct the stream or reclassify the row side-channel`,
    );
  if (
    entry.disposition === "side-channel" &&
    (typeof entry.note !== "string" || entry.note.trim() === "")
  )
    errors.push(
      `${id}: side-channel output row requires a note saying why it is neither a rendered result nor a raised error`,
    );
  // The stream-direction rule. Writing a result to the stream the Agent does
  // not read is a silent failure that no unit test sees, which is how a real
  // reply was lost; a row may not claim parity while inverting the stream.
  if (entry.verdict === "aligned" && streams.rah !== streams.raft)
    errors.push(
      `${id}: aligned output row records RAH writing ${String(streams.rah)} where Raft writes ${String(streams.raft)}; upstream renders results on stdout and raises errors on stderr, so reconcile the stream before calling this row aligned`,
    );
  if (entry.verdict === "missing") {
    if (streams.rah !== null || format.rah !== null || exit.rah !== null)
      errors.push(
        `${id}: a missing output surface must record streams.rah, format.rah and exit.rah as null`,
      );
  } else if (streams.rah === null)
    errors.push(
      `${id}: ${entry.verdict} output row must record the stream RAH writes to`,
    );
}

// An error-code row records one Raft `cliError` code, the recovery guidance
// Raft attaches to it, and RAH's counterpart code if it has one.
function validateErrorCodeRow(entry, errors) {
  const id = entry.id;
  if (typeof entry.code !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(entry.code))
    errors.push(`${id}: code must be a Raft cliError code literal`);
  if (typeof entry.raftNextAction !== "string" || entry.raftNextAction === "")
    errors.push(
      `${id}: raftNextAction must state the suggestedNextAction Raft attaches, or "none"`,
    );
  if (entry.rahCode !== null && typeof entry.rahCode !== "string")
    errors.push(`${id}: rahCode must be a string or null`);
  if (entry.verdict === "aligned" && entry.rahCode === null)
    errors.push(
      `${id}: aligned error-code row must name the RAH code the Agent sees`,
    );
  if (entry.verdict === "missing" && entry.rahCode !== null)
    errors.push(`${id}: a missing error code cannot name a RAH code`);
}

// A format row records one Agent-visible command's default output mode and
// whether `--json` exists, on both sides.
function validateOutputFormatRow(entry, errors) {
  const id = entry.id;
  const mode = entry.outputMode ?? {};
  const flag = entry.jsonFlag ?? {};
  if (!entry.rah?.symbol)
    errors.push(`${id}: output-format row must name the RAH command`);
  if (!OUTPUT_MODES.includes(mode.rah))
    errors.push(
      `${id}: outputMode.rah must be one of ${OUTPUT_MODES.join(", ")}`,
    );
  if (typeof flag.rah !== "boolean")
    errors.push(`${id}: jsonFlag.rah must say whether RAH offers --json`);
  if (mode.raft !== null && !OUTPUT_MODES.includes(mode.raft))
    errors.push(
      `${id}: outputMode.raft must be null or one of ${OUTPUT_MODES.join(", ")}`,
    );
  if (flag.raft !== null && typeof flag.raft !== "boolean")
    errors.push(`${id}: jsonFlag.raft must be a boolean or null`);
  if ((mode.raft === null) !== (flag.raft === null))
    errors.push(
      `${id}: a command with no Raft counterpart must record both outputMode.raft and jsonFlag.raft as null`,
    );
  if (
    entry.verdict === "aligned" &&
    (mode.raft !== mode.rah || flag.raft !== flag.rah)
  )
    errors.push(
      `${id}: aligned format row records RAH defaulting to ${String(mode.rah)} where Raft defaults to ${String(mode.raft)}`,
    );
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
    if (!EVIDENCE.includes(entry.upstreamEvidence))
      errors.push(
        `${id}: upstreamEvidence must be one of ${EVIDENCE.join(", ")}`,
      );
    // Ruling 2: only a row whose upstream claim we can read may accuse RAH of a
    // divergence or clear it as a match.
    if (
      entry.upstreamEvidence === "server-inferred" &&
      ["aligned", "unjustified"].includes(entry.verdict)
    )
      errors.push(
        `${id}: ${entry.verdict} entry rests on server-inferred evidence; Raft's Server is closed, so reclassify it undecidable`,
      );
    if (entry.verdict === "undecidable") {
      if (entry.upstreamEvidence !== "server-inferred")
        errors.push(
          `${id}: undecidable entry must be server-inferred; adjudicate it against the ${entry.upstreamEvidence} evidence it cites`,
        );
      if (typeof entry.note !== "string" || entry.note.trim() === "")
        errors.push(
          `${id}: undecidable entry requires a note naming the missing Server fact`,
        );
    }
    if (entry.kind === "output") validateOutputRow(entry, errors);
    if (entry.kind === "error-code") validateErrorCodeRow(entry, errors);
    if (entry.kind === "output-format") validateOutputFormatRow(entry, errors);
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

  // Every Agent-visible command must additionally declare how it answers: the
  // default rendering, and whether `--json` exists at all. A command that
  // declares neither is a surface the output/error registry cannot see.
  const declaredFormats = new Map(
    registry.entries
      .filter((entry) => entry.kind === "output-format" && entry.rah?.symbol)
      .map((entry) => [entry.rah.symbol, entry]),
  );
  for (const command of commands) {
    const row = declaredFormats.get(command);
    if (
      !row ||
      !OUTPUT_MODES.includes(row.outputMode?.rah) ||
      typeof row.jsonFlag?.rah !== "boolean"
    )
      errors.push(
        `undeclared agent-facing surface: rah ${command} declares no default output mode and no --json availability`,
      );
  }
  for (const command of declaredFormats.keys())
    if (cliSource && !commands.includes(command))
      errors.push(
        `registered surface no longer exists: rah ${command}; retire its output-format entry`,
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
    aligned: registry.entries.filter((entry) => entry.verdict === "aligned")
      .length,
    justified: registry.entries.filter((entry) => entry.verdict === "justified")
      .length,
    unjustified: registry.entries.filter(
      (entry) => entry.verdict === "unjustified",
    ).length,
    undecidable: registry.entries.filter(
      (entry) => entry.verdict === "undecidable",
    ).length,
    missingNonDeferred: registry.entries.filter(
      (entry) => entry.verdict === "missing" && entry.deferred !== true,
    ).length,
    outputSurfaceRows: registry.entries.filter((entry) =>
      OUTPUT_KINDS.has(entry.kind),
    ).length,
    outputSurfaceUnjustified: registry.entries.filter(
      (entry) =>
        OUTPUT_KINDS.has(entry.kind) && entry.verdict === "unjustified",
    ).length,
    outputSurfaceMissingNonDeferred: registry.entries.filter(
      (entry) =>
        OUTPUT_KINDS.has(entry.kind) &&
        entry.verdict === "missing" &&
        entry.deferred !== true,
    ).length,
  };
  // Ratchet directions, mirrored in the registry's `ratchetNotes`:
  // `unjustified` and `missingNonDeferred` fall as RAH replicates the Raft
  // contract. `undecidable` is not a repair backlog: it may rise only when a
  // new Agent-facing surface is added whose upstream behaviour is Server-held,
  // never by reclassifying a row that already cites client-side evidence, and
  // it must fall the moment Raft's Server becomes readable, because every row
  // it covers is then adjudicable as aligned, justified or unjustified.
  const ratchet = registry.ratchet ?? {};
  if (counts.unjustified > (ratchet.unjustified ?? 0))
    errors.push(
      `unjustified divergences rose to ${counts.unjustified}; replicate the Raft contract instead of raising the ${ratchet.unjustified} ratchet`,
    );
  if (counts.undecidable > (ratchet.undecidable ?? 0))
    errors.push(
      `undecidable divergences rose to ${counts.undecidable}; only a newly added surface with Server-held upstream behaviour may raise the ${ratchet.undecidable} ratchet`,
    );
  if (counts.missingNonDeferred > (ratchet.missingNonDeferred ?? 0))
    errors.push(
      `non-deferred missing surfaces rose to ${counts.missingNonDeferred}; port the Raft surface instead of raising the ${ratchet.missingNonDeferred} ratchet`,
    );

  if (counts.outputSurfaceUnjustified > (ratchet.outputSurfaceUnjustified ?? 0))
    errors.push(
      `unjustified output and error divergences rose to ${counts.outputSurfaceUnjustified}; replicate the Raft output contract instead of raising the ${ratchet.outputSurfaceUnjustified} ratchet`,
    );
  if (
    counts.outputSurfaceMissingNonDeferred >
    (ratchet.outputSurfaceMissingNonDeferred ?? 0)
  )
    errors.push(
      `non-deferred missing output and error surfaces rose to ${counts.outputSurfaceMissingNonDeferred}; port the Raft surface instead of raising the ${ratchet.outputSurfaceMissingNonDeferred} ratchet`,
    );

  const promptParts = [
    safeRead(promptPath, "prompt source"),
    safeRead(promptProtocolPath, "prompt protocol source"),
  ];
  const promptSource = promptParts.every((part) => part)
    ? promptParts.join("\n")
    : undefined;
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
        `aligned ${result.counts.aligned}`,
        `justified ${result.counts.justified}`,
        `unjustified ${result.counts.unjustified}/${registry.ratchet.unjustified}`,
        `undecidable ${result.counts.undecidable}/${registry.ratchet.undecidable}`,
        `non-deferred missing ${result.counts.missingNonDeferred}/${registry.ratchet.missingNonDeferred}`,
        `output surface rows ${result.counts.outputSurfaceRows}`,
        `output surface unjustified ${result.counts.outputSurfaceUnjustified}/${registry.ratchet.outputSurfaceUnjustified}`,
        `output surface non-deferred missing ${result.counts.outputSurfaceMissingNonDeferred}/${registry.ratchet.outputSurfaceMissingNonDeferred}`,
        `standing prompt judgment paragraphs ${result.judgmentPresent}/${registry.ratchet.promptJudgmentParagraphs}`,
        `upstream anchors verified ${result.anchorsChecked}`,
      ].join("; "),
    );
}
