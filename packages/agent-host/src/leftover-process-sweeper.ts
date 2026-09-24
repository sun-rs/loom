import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

/**
 * S2-0 leftover-process hygiene (S2 spec §6a).
 *
 * The Host tags every Provider process tree it spawns with the two
 * environment fences below. Tools that escape the run's process group with
 * `setsid`, `nohup` plus a new group, or a double fork keep the tags, because
 * environment is inherited across fork/exec unless a program clears it.
 *
 * Enumeration (single owner: `createSystemProcessTable`):
 * - macOS: `ps -A -o ...` for the table and `ps -A -E -o pid=,lstart=,command=`
 *   for the environment of same-UID processes. A row is matched to the table
 *   by pid AND start time; the environment is the suffix after the plain
 *   command line, so an argv that merely contains the tag text is not
 *   mistaken for it. `ps -E` joins entries with spaces, so parsing is not
 *   unambiguous: only `LOOM_RUNTIME_ID=<id>` tokens with the Host id grammar
 *   are read, and when the suffix holds different values, or the command
 *   changed between the two calls, the row carries `tagCandidates` instead of
 *   a tag. Such a process is never signalled; if a candidate is a swept
 *   runtime it is reported `unknown` (blocking). A value that embeds exactly
 *   our own tag text would still read as tagged (residual; reading
 *   KERN_PROCARGS2 needs native code, and `sysctl(8)` does not expose it).
 *   macOS does not expose the environment of platform (Apple-signed, e.g.
 *   /bin/sh, /bin/sleep) binaries to `ps -E`.
 * - Linux: the same `ps` table and `/proc/<pid>/environ` (NUL-separated,
 *   unambiguous) for same-UID processes.
 * Every system query has a timeout; a failed or timed-out query throws (the
 * caller records "unknown", never "empty"). A failed port query leaves port
 * state unknown (`portsObserved: false`) while process counts stay known.
 *
 * Limits: a process that clears its environment, or whose environment the OS
 * hides, is found only as a descendant (ppid chain, while its parent is still
 * alive) or as a member of a process group led by a tagged process. Groups
 * of tagged leaders are remembered per runtime whenever this sweeper sees the
 * leader alive (cap measurement, sweep passes), so untagged members are still
 * found after the leader exits; a group whose leader pid now belongs to a
 * different process (start time differs) is dropped. A detached,
 * environment-less process whose tagged ancestors exited before any
 * observation escapes, and the resource-cap measurement uses the same scan,
 * so it cannot compensate for such invisible processes.
 *
 * PID reuse: identity is UID + start time (`lstart`, one second resolution;
 * a finer birth time needs `proc_pidinfo`/KERN_PROC, unreachable without
 * native code). It is re-read for each pid immediately before its signal, so
 * the window is one `ps` call plus one `kill(2)`; `kill` is not an atomic
 * compare-and-signal, so a pid that exits and is reused within that window
 * in the same second can still be signalled (residual). Tags are not a
 * security principal against same-UID code; the target is the normal
 * leftovers of managed CLIs.
 */
export const LOOM_RUNTIME_ID_ENV = "LOOM_RUNTIME_ID";
export const LOOM_RUN_ID_ENV = "LOOM_RUN_ID";
/** One Host line for the next wake; read by `providerActivationInput()`. */
export const RAH_RUNTIME_NOTICE_ENV = "RAH_RUNTIME_NOTICE";

export type ProcessIdentity = {
  pid: number;
  startedAt: string;
  uid: number;
};

export type ProcessRecord = ProcessIdentity & {
  command: string;
  pgid: number;
  ppid: number;
  rssKb: number;
  runId?: string;
  runtimeId?: string;
  /** The environment could not be parsed unambiguously (macOS `ps -E`). */
  tagCandidates?: string[];
};

export interface ProcessTable {
  identities(pids: readonly number[]): Promise<Map<number, ProcessIdentity>>;
  /** Throws when the table cannot be read; never returns a partial table. */
  list(): Promise<ProcessRecord[]>;
  /** pid -> TCP listening ports. Throws when ports cannot be observed. */
  listeningPorts(pids: readonly number[]): Promise<Map<number, number[]>>;
  /** port -> pids listening on it now (any process). Throws on failure. */
  listenersOnPorts?(ports: readonly number[]): Promise<Map<number, number[]>>;
  signal(pid: number, signal: NodeJS.Signals): void;
}

export type LeftoverFootprint = {
  listeningPorts: number[];
  /** False when the port query failed: port state is unknown, not empty. */
  portsObserved: boolean;
  processCount: number;
  rssKb: number;
};

export type LeftoverSweepResult = {
  found: number;
  killed: number;
  /**
   * Ports that swept processes were listening on, whose holders are no
   * longer alive and (when the post-kill check ran) that no process listens
   * on now. Not a promise that the port stays free.
   */
  releasedPorts: number[];
  /** Target-tree processes present in the final rescan. */
  remaining: number;
  remainingPorts: number[];
  /** Processes whose tag could not be read unambiguously (never signalled). */
  unknown: number;
  portsObserved: boolean;
  footprint: LeftoverFootprint;
};

export type LeftoverProcessSweeperOptions = {
  graceMs?: number;
  killWaitMs?: number;
  pollMs?: number;
  selfPid?: number;
  table: ProcessTable;
  uid?: number;
};

export class LeftoverProcessSweeper {
  readonly #graceMs: number;
  readonly #killWaitMs: number;
  readonly #pollMs: number;
  readonly #selfPid: number;
  readonly #table: ProcessTable;
  readonly #uid: number | undefined;
  /** runtime id -> (pgid -> leader start time), seen while the leader lived. */
  readonly #knownGroups = new Map<string, Map<number, string>>();

  constructor(options: LeftoverProcessSweeperOptions) {
    this.#graceMs = options.graceMs ?? 2_000;
    this.#killWaitMs = options.killWaitMs ?? 2_000;
    this.#pollMs = options.pollMs ?? 50;
    this.#selfPid = options.selfPid ?? process.pid;
    this.#table = options.table;
    this.#uid = options.uid ?? process.getuid?.();
  }

  /** Runtime ids carried by live same-UID processes (janitor input). */
  async taggedRuntimeIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const entry of await this.#ownProcesses()) {
      if (entry.runtimeId !== undefined) ids.add(entry.runtimeId);
      for (const candidate of entry.tagCandidates ?? []) ids.add(candidate);
    }
    return ids;
  }

  /** Live footprint of the given runtimes' trees; never signals. */
  async measure(runtimeIds: ReadonlySet<string>): Promise<LeftoverFootprint> {
    const processes = await this.#ownProcesses();
    this.#rememberGroups(processes, runtimeIds);
    const members = collectTrees(
      processes,
      runtimeIds,
      this.#groupsFor(processes, runtimeIds),
    );
    return await this.#footprint(members);
  }

  /**
   * SIGTERM -> grace -> SIGKILL every process of the given (no longer live)
   * runtimes, in at most two bounded passes (the second catches children
   * spawned during the grace). A final rescan of the complete target set
   * decides `remaining`: anything still present, including descendants born
   * during the last pass, is reported, never assumed gone.
   */
  async sweep(runtimeIds: ReadonlySet<string>): Promise<LeftoverSweepResult> {
    const seen = new Map<number, ProcessRecord>();
    const ports = new Map<number, number[]>();
    const signalled = new Set<number>();
    let portsObserved = true;
    let footprint: LeftoverFootprint = {
      listeningPorts: [],
      portsObserved: true,
      processCount: 0,
      rssKb: 0,
    };
    for (let pass = 0; pass < 2; pass += 1) {
      const processes = await this.#ownProcesses();
      this.#rememberGroups(processes, runtimeIds);
      const fresh = collectTrees(
        processes,
        runtimeIds,
        this.#groupsFor(processes, runtimeIds),
      ).filter((entry) => !seen.has(entry.pid));
      if (fresh.length === 0) break;
      if (pass === 0) {
        footprint = await this.#footprint(fresh);
        portsObserved &&= footprint.portsObserved;
      }
      for (const entry of fresh) seen.set(entry.pid, entry);
      try {
        for (const [pid, owned] of await this.#table.listeningPorts(
          fresh.map((entry) => entry.pid),
        ))
          ports.set(pid, owned);
      } catch {
        portsObserved = false;
      }
      for (const pid of await this.#signalVerified(fresh, "SIGTERM"))
        signalled.add(pid);
      let alive = await this.#waitGone(fresh, this.#graceMs);
      if (alive.length > 0) {
        for (const pid of await this.#signalVerified(alive, "SIGKILL"))
          signalled.add(pid);
        alive = await this.#waitGone(alive, this.#killWaitMs);
      }
    }
    // Final rescan of the whole target set (S2-0 review P1-3).
    const finalProcesses = await this.#ownProcesses();
    const left = collectTrees(
      finalProcesses,
      runtimeIds,
      this.#groupsFor(finalProcesses, runtimeIds),
    );
    const unknown = finalProcesses.filter(
      (entry) =>
        entry.runtimeId === undefined &&
        !left.some((member) => member.pid === entry.pid) &&
        (entry.tagCandidates ?? []).some((id) => runtimeIds.has(id)),
    ).length;
    const stillPresent = new Set(left.map((entry) => entry.pid));
    const unseen = left.filter((entry) => !seen.has(entry.pid));
    if (unseen.length > 0)
      try {
        for (const [pid, owned] of await this.#table.listeningPorts(
          unseen.map((entry) => entry.pid),
        ))
          ports.set(pid, owned);
      } catch {
        portsObserved = false;
      }
    const remainingPorts: number[] = [];
    let releasedPorts: number[] = [];
    for (const [pid, owned] of ports)
      (stillPresent.has(pid) ? remainingPorts : releasedPorts).push(...owned);
    releasedPorts = sortedUnique(releasedPorts).filter(
      (port) => !remainingPorts.includes(port),
    );
    if (releasedPorts.length > 0 && this.#table.listenersOnPorts !== undefined)
      try {
        const listening = await this.#table.listenersOnPorts(releasedPorts);
        releasedPorts = releasedPorts.filter((port) => !listening.has(port));
      } catch {
        portsObserved = false;
        releasedPorts = [];
      }
    else if (!portsObserved) releasedPorts = [];
    if (stillPresent.size === 0 && unknown === 0)
      for (const id of runtimeIds) this.#knownGroups.delete(id);
    return {
      footprint,
      found: seen.size,
      killed: [...signalled].filter((pid) => !stillPresent.has(pid)).length,
      portsObserved,
      releasedPorts,
      remaining: stillPresent.size,
      remainingPorts: sortedUnique(remainingPorts),
      unknown,
    };
  }

  /** Tagged group leaders seen alive: remember their group per runtime. */
  #rememberGroups(
    processes: ProcessRecord[],
    runtimeIds: ReadonlySet<string>,
  ): void {
    for (const entry of processes) {
      if (
        entry.runtimeId === undefined ||
        !runtimeIds.has(entry.runtimeId) ||
        entry.pgid !== entry.pid
      )
        continue;
      const groups = this.#knownGroups.get(entry.runtimeId) ?? new Map();
      if (!groups.has(entry.pgid) && groups.size >= KNOWN_GROUP_LIMIT) continue;
      groups.set(entry.pgid, entry.startedAt);
      this.#knownGroups.set(entry.runtimeId, groups);
    }
  }

  /**
   * Remembered groups of these runtimes that still exist as the same group:
   * a group whose leader pid is alive with another start time was reused.
   */
  #groupsFor(
    processes: ProcessRecord[],
    runtimeIds: ReadonlySet<string>,
  ): Set<number> {
    const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
    const result = new Set<number>();
    for (const id of runtimeIds) {
      const groups = this.#knownGroups.get(id);
      if (groups === undefined) continue;
      for (const [pgid, leaderStartedAt] of groups) {
        const leader = byPid.get(pgid);
        if (leader !== undefined && leader.startedAt !== leaderStartedAt) {
          groups.delete(pgid);
          continue;
        }
        result.add(pgid);
      }
      if (groups.size === 0) this.#knownGroups.delete(id);
    }
    return result;
  }

  async #ownProcesses(): Promise<ProcessRecord[]> {
    return (await this.#table.list()).filter(
      (entry) =>
        entry.pid !== this.#selfPid &&
        entry.pid > 1 &&
        (this.#uid === undefined || entry.uid === this.#uid),
    );
  }

  async #footprint(members: ProcessRecord[]): Promise<LeftoverFootprint> {
    let listeningPorts: number[] = [];
    let portsObserved = true;
    try {
      const ports = await this.#table.listeningPorts(
        members.map((entry) => entry.pid),
      );
      listeningPorts = sortedUnique([...ports.values()].flat());
    } catch {
      portsObserved = false;
    }
    return {
      listeningPorts,
      portsObserved,
      processCount: members.length,
      rssKb: members.reduce((total, entry) => total + entry.rssKb, 0),
    };
  }

  /**
   * Signals only processes whose UID and start time still match, re-read
   * for each pid immediately before its own signal.
   */
  async #signalVerified(
    records: ProcessRecord[],
    signal: NodeJS.Signals,
  ): Promise<number[]> {
    const signalled: number[] = [];
    for (const entry of records) {
      if ((await this.#aliveSame([entry])).length === 0) continue;
      try {
        this.#table.signal(entry.pid, signal);
        signalled.push(entry.pid);
      } catch {
        // Gone in between, or not permitted: counted by the final scan.
      }
    }
    return signalled;
  }

  async #aliveSame(records: ProcessRecord[]): Promise<ProcessRecord[]> {
    if (records.length === 0) return [];
    const identities = await this.#table.identities(
      records.map((entry) => entry.pid),
    );
    return records.filter((entry) => {
      const current = identities.get(entry.pid);
      return (
        current !== undefined &&
        current.uid === entry.uid &&
        current.startedAt === entry.startedAt
      );
    });
  }

  async #waitGone(
    records: ProcessRecord[],
    timeoutMs: number,
  ): Promise<ProcessRecord[]> {
    const deadline = Date.now() + timeoutMs;
    let alive = await this.#aliveSame(records);
    while (alive.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.#pollMs));
      alive = await this.#aliveSame(alive);
    }
    return alive;
  }
}

const KNOWN_GROUP_LIMIT = 64;

/**
 * Tagged processes, their descendants (ppid closure) and members of process
 * groups led by a tagged process (alive now, or remembered while it lived).
 * Groups led by anyone else are not widened. A process with ambiguous tag
 * candidates joins only through ancestry or a group, never by its text.
 */
function collectTrees(
  processes: ProcessRecord[],
  runtimeIds: ReadonlySet<string>,
  knownGroups: ReadonlySet<number> = new Set(),
): ProcessRecord[] {
  const selected = new Map<number, ProcessRecord>();
  for (const entry of processes)
    if (entry.runtimeId !== undefined && runtimeIds.has(entry.runtimeId))
      selected.set(entry.pid, entry);
  const leaders = new Set([
    ...[...selected.values()]
      .filter((entry) => entry.pgid === entry.pid)
      .map((entry) => entry.pid),
    ...knownGroups,
  ]);
  for (const entry of processes)
    if (leaders.has(entry.pgid) && !isForeignTagged(entry, runtimeIds))
      selected.set(entry.pid, entry);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of processes) {
      if (selected.has(entry.pid) || !selected.has(entry.ppid)) continue;
      if (isForeignTagged(entry, runtimeIds)) continue;
      selected.set(entry.pid, entry);
      grew = true;
    }
  }
  return [...selected.values()];
}

/** A process tagged by another runtime belongs to that runtime, not ours. */
function isForeignTagged(
  entry: ProcessRecord,
  runtimeIds: ReadonlySet<string>,
): boolean {
  if (entry.runtimeId !== undefined) return !runtimeIds.has(entry.runtimeId);
  // Ambiguous text that names only other runtimes is not ours to widen into.
  return (
    entry.tagCandidates !== undefined &&
    entry.tagCandidates.length > 0 &&
    !entry.tagCandidates.some((id) => runtimeIds.has(id))
  );
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

// ---------------------------------------------------------------------------
// System process table (macOS / Linux)

const PS_ENV = { ...process.env, LC_ALL: "C", LANG: "C" };
const LSTART_PATTERN = /^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}/u;
/** Bound on every system query; a hung ps/lsof fails as "unknown". */
export const PROCESS_QUERY_TIMEOUT_MS = 15_000;

function run(
  command: string,
  args: string[],
  timeoutMs = PROCESS_QUERY_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        env: PS_ENV,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout) => {
        // lsof exits 1 when nothing matches; ps exits 1 for unknown pids. A
        // timeout kills the child (code null) and is always a failure.
        if (
          error &&
          ((error as { killed?: unknown }).killed === true ||
            (error as { code?: unknown }).code !== 1)
        ) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

type ParsedRow = Omit<ProcessRecord, "runId" | "runtimeId" | "tagCandidates">;
type EnvironmentTags = {
  runId?: string;
  runtimeId?: string;
  tagCandidates?: string[];
};

function parseTableLine(line: string): ParsedRow | undefined {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
  if (!match) return undefined;
  const rest = match[6]!;
  const started = LSTART_PATTERN.exec(rest);
  if (!started) return undefined;
  return {
    command: rest.slice(started[0].length).trim(),
    pgid: Number(match[3]),
    pid: Number(match[1]),
    ppid: Number(match[2]),
    rssKb: Number(match[5]),
    startedAt: started[0].replace(/\s+/gu, " "),
    uid: Number(match[4]),
  };
}

function tagsFromEnvironment(pairs: Iterable<string>): EnvironmentTags {
  const tags: { runId?: string; runtimeId?: string } = {};
  for (const pair of pairs) {
    if (pair.startsWith(`${LOOM_RUNTIME_ID_ENV}=`))
      tags.runtimeId = pair.slice(LOOM_RUNTIME_ID_ENV.length + 1);
    else if (pair.startsWith(`${LOOM_RUN_ID_ENV}=`))
      tags.runId = pair.slice(LOOM_RUN_ID_ENV.length + 1);
  }
  return {
    ...(tags.runtimeId ? { runtimeId: tags.runtimeId } : {}),
    ...(tags.runId ? { runId: tags.runId } : {}),
  };
}

/** Host-generated ids (`process:<uuid>`, `instrt_<uuid>`, ...). */
const TAG_VALUE = "[A-Za-z0-9:_.\\-]{1,200}";
const RUNTIME_TAG = new RegExp(
  `(?:^|\\s)${LOOM_RUNTIME_ID_ENV}=(${TAG_VALUE})(?=\\s|$)`,
  "gu",
);
const RUN_TAG = new RegExp(
  `(?:^|\\s)${LOOM_RUN_ID_ENV}=(${TAG_VALUE})(?=\\s|$)`,
  "gu",
);

function distinctMatches(pattern: RegExp, text: string): string[] {
  return [
    ...new Set([...text.matchAll(pattern)].map((match) => match[1]!)),
  ].sort();
}

/**
 * macOS `ps -E` line -> tags. `full` is the command column with the
 * environment appended; `command` is the plain command column of the same
 * process. Only the suffix is environment. Different runtime-id values in
 * it, or a command that no longer prefixes the line, yield candidates only.
 */
export function parseDarwinEnvironmentTags(
  full: string,
  command: string,
): EnvironmentTags {
  if (!full.includes(`${LOOM_RUNTIME_ID_ENV}=`)) return {};
  if (!full.startsWith(command)) {
    const candidates = distinctMatches(RUNTIME_TAG, full);
    return candidates.length === 0 ? {} : { tagCandidates: candidates };
  }
  const suffix = full.slice(command.length);
  const runtimeIds = distinctMatches(RUNTIME_TAG, suffix);
  if (runtimeIds.length === 0) return {};
  if (runtimeIds.length > 1) return { tagCandidates: runtimeIds };
  const runIds = distinctMatches(RUN_TAG, suffix);
  return {
    runtimeId: runtimeIds[0]!,
    ...(runIds.length === 1 ? { runId: runIds[0]! } : {}),
  };
}

async function darwinEnvironmentTags(
  rows: Map<number, ParsedRow>,
): Promise<Map<number, EnvironmentTags>> {
  const result = new Map<number, EnvironmentTags>();
  const output = await run("ps", [
    "-A",
    "-E",
    "-ww",
    "-o",
    "pid=,lstart=,command=",
  ]);
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const row = rows.get(pid);
    if (!row) continue;
    const started = LSTART_PATTERN.exec(match[2]!);
    // A different start time is a different process (pid reused between
    // the two calls): its environment says nothing about this row.
    if (!started || started[0].replace(/\s+/gu, " ") !== row.startedAt)
      continue;
    const full = match[2]!.slice(started[0].length).trimStart();
    const tags = parseDarwinEnvironmentTags(full, row.command);
    if (tags.runtimeId !== undefined || tags.tagCandidates !== undefined)
      result.set(pid, tags);
  }
  return result;
}

async function linuxEnvironmentTags(
  rows: Map<number, ParsedRow>,
  uid: number | undefined,
): Promise<Map<number, EnvironmentTags>> {
  const result = new Map<number, EnvironmentTags>();
  await Promise.all(
    [...rows.values()]
      .filter((row) => uid === undefined || row.uid === uid)
      .map(async (row) => {
        try {
          const environ = await readFile(`/proc/${row.pid}/environ`, "utf8");
          if (!environ.includes("LOOM_")) return;
          const tags = tagsFromEnvironment(environ.split("\0"));
          if (tags.runtimeId !== undefined) result.set(row.pid, tags);
        } catch {
          // Exited, or not readable: untagged for this scan.
        }
      }),
  );
  return result;
}

function parseListeners(output: string): Map<number, number[]> {
  const result = new Map<number, number[]>();
  let current: number | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) current = Number(line.slice(1));
    else if (line.startsWith("n") && current !== undefined) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (!Number.isInteger(port) || port <= 0) continue;
      const owned = result.get(current) ?? [];
      if (!owned.includes(port)) owned.push(port);
      result.set(current, owned);
    }
  }
  return result;
}

export function createSystemProcessTable(): ProcessTable {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error(
      `leftover-process enumeration is not supported on ${process.platform}`,
    );
  const uid = process.getuid?.();
  const tableColumns = "pid=,ppid=,pgid=,uid=,rss=,lstart=,command=";
  return {
    async list() {
      const output = await run("ps", ["-A", "-ww", "-o", tableColumns]);
      const rows = new Map<number, ParsedRow>();
      for (const line of output.split("\n")) {
        const row = parseTableLine(line);
        if (row) rows.set(row.pid, row);
      }
      if (rows.size === 0)
        throw new Error("ps returned an empty process table");
      const tags =
        process.platform === "darwin"
          ? await darwinEnvironmentTags(rows)
          : await linuxEnvironmentTags(rows, uid);
      return [...rows.values()].map((row) => ({
        ...row,
        ...tags.get(row.pid),
      }));
    },
    async identities(pids) {
      const result = new Map<number, ProcessIdentity>();
      if (pids.length === 0) return result;
      const output = await run("ps", [
        "-ww",
        "-o",
        tableColumns,
        "-p",
        pids.join(","),
      ]);
      for (const line of output.split("\n")) {
        const row = parseTableLine(line);
        if (row)
          result.set(row.pid, {
            pid: row.pid,
            startedAt: row.startedAt,
            uid: row.uid,
          });
      }
      return result;
    },
    async listeningPorts(pids) {
      if (pids.length === 0) return new Map();
      return parseListeners(
        await run("lsof", [
          "-nP",
          "-a",
          "-iTCP",
          "-sTCP:LISTEN",
          "-p",
          pids.join(","),
          "-Fpn",
        ]),
      );
    },
    async listenersOnPorts(ports) {
      const result = new Map<number, number[]>();
      if (ports.length === 0) return result;
      const byPid = parseListeners(
        await run("lsof", [
          "-nP",
          `-iTCP:${ports.join(",")}`,
          "-sTCP:LISTEN",
          "-Fpn",
        ]),
      );
      for (const [pid, owned] of byPid)
        for (const port of owned)
          if (ports.includes(port))
            result.set(port, [...(result.get(port) ?? []), pid]);
      return result;
    },
    signal(pid, signal) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if ((error as { code?: unknown }).code !== "ESRCH") throw error;
      }
    },
  };
}
