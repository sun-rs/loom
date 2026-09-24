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
 * - macOS: `ps -A -o ...` for the table and `ps -A -E -o pid=,command=` for
 *   the environment of same-UID processes; the environment is the suffix after
 *   the plain command line, so an argv that merely contains the tag text is
 *   not mistaken for it. macOS does not expose the environment of platform
 *   (Apple-signed, e.g. /bin/sh, /bin/sleep) binaries to `ps -E`.
 * - Linux: the same `ps` table and `/proc/<pid>/environ` for same-UID
 *   processes.
 * Limits: a process that clears its environment, or whose environment the OS
 * hides, is found only as a descendant (ppid chain, while its parent is still
 * alive) or as a member of a process group led by a tagged process. A
 * detached, environment-less process whose tagged ancestors have all exited
 * escapes. Identity before any signal is UID + start time (`lstart`, one
 * second resolution) re-read immediately before signalling (PID reuse).
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
};

export interface ProcessTable {
  identities(pids: readonly number[]): Promise<Map<number, ProcessIdentity>>;
  list(): Promise<ProcessRecord[]>;
  listeningPorts(pids: readonly number[]): Promise<Map<number, number[]>>;
  signal(pid: number, signal: NodeJS.Signals): void;
}

export type LeftoverFootprint = {
  listeningPorts: number[];
  processCount: number;
  rssKb: number;
};

export type LeftoverSweepResult = {
  found: number;
  killed: number;
  releasedPorts: number[];
  remaining: number;
  remainingPorts: number[];
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
    for (const entry of await this.#ownProcesses())
      if (entry.runtimeId !== undefined) ids.add(entry.runtimeId);
    return ids;
  }

  /** Live footprint of the given runtimes' trees; never signals. */
  async measure(runtimeIds: ReadonlySet<string>): Promise<LeftoverFootprint> {
    const members = collectTrees(await this.#ownProcesses(), runtimeIds);
    return await this.#footprint(members);
  }

  /**
   * SIGTERM -> grace -> SIGKILL every process of the given (no longer live)
   * runtimes. A second scan catches children spawned during the grace.
   */
  async sweep(runtimeIds: ReadonlySet<string>): Promise<LeftoverSweepResult> {
    const seen = new Map<number, ProcessRecord>();
    const ports = new Map<number, number[]>();
    const signalled = new Set<number>();
    let footprint: LeftoverFootprint = {
      listeningPorts: [],
      processCount: 0,
      rssKb: 0,
    };
    for (let pass = 0; pass < 2; pass += 1) {
      const fresh = collectTrees(await this.#ownProcesses(), runtimeIds).filter(
        (entry) => !seen.has(entry.pid),
      );
      if (fresh.length === 0) break;
      if (pass === 0) footprint = await this.#footprint(fresh);
      for (const entry of fresh) seen.set(entry.pid, entry);
      for (const [pid, owned] of await this.#table.listeningPorts(
        fresh.map((entry) => entry.pid),
      ))
        ports.set(pid, owned);
      for (const pid of await this.#signalVerified(fresh, "SIGTERM"))
        signalled.add(pid);
      let alive = await this.#waitGone(fresh, this.#graceMs);
      if (alive.length > 0) {
        for (const pid of await this.#signalVerified(alive, "SIGKILL"))
          signalled.add(pid);
        alive = await this.#waitGone(alive, this.#killWaitMs);
      }
    }
    const records = [...seen.values()];
    const stillAlive = new Set(
      (await this.#aliveSame(records)).map((entry) => entry.pid),
    );
    const releasedPorts: number[] = [];
    const remainingPorts: number[] = [];
    for (const [pid, owned] of ports)
      (stillAlive.has(pid) ? remainingPorts : releasedPorts).push(...owned);
    return {
      footprint,
      found: records.length,
      killed: [...signalled].filter((pid) => !stillAlive.has(pid)).length,
      releasedPorts: sortedUnique(releasedPorts),
      remaining: stillAlive.size,
      remainingPorts: sortedUnique(remainingPorts),
    };
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
    const ports = await this.#table.listeningPorts(
      members.map((entry) => entry.pid),
    );
    return {
      listeningPorts: sortedUnique([...ports.values()].flat()),
      processCount: members.length,
      rssKb: members.reduce((total, entry) => total + entry.rssKb, 0),
    };
  }

  /** Signals only processes whose UID and start time still match. */
  async #signalVerified(
    records: ProcessRecord[],
    signal: NodeJS.Signals,
  ): Promise<number[]> {
    const signalled: number[] = [];
    for (const entry of await this.#aliveSame(records)) {
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

/**
 * Tagged processes, their descendants (ppid closure) and members of process
 * groups led by a tagged process. Groups led by anyone else are not widened.
 */
function collectTrees(
  processes: ProcessRecord[],
  runtimeIds: ReadonlySet<string>,
): ProcessRecord[] {
  const selected = new Map<number, ProcessRecord>();
  for (const entry of processes)
    if (entry.runtimeId !== undefined && runtimeIds.has(entry.runtimeId))
      selected.set(entry.pid, entry);
  const leaders = new Set(
    [...selected.values()]
      .filter((entry) => entry.pgid === entry.pid)
      .map((entry) => entry.pid),
  );
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
  return entry.runtimeId !== undefined && !runtimeIds.has(entry.runtimeId);
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

// ---------------------------------------------------------------------------
// System process table (macOS / Linux)

const PS_ENV = { ...process.env, LC_ALL: "C", LANG: "C" };
const LSTART_PATTERN = /^\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}/u;

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", env: PS_ENV, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        // lsof exits 1 when nothing matches; ps exits 1 for unknown pids.
        if (error && (error as { code?: unknown }).code !== 1) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

type ParsedRow = Omit<ProcessRecord, "runId" | "runtimeId">;

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

function tagsFromEnvironment(pairs: Iterable<string>): {
  runId?: string;
  runtimeId?: string;
} {
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

async function darwinEnvironmentTags(
  rows: Map<number, ParsedRow>,
): Promise<Map<number, { runId?: string; runtimeId?: string }>> {
  const result = new Map<number, { runId?: string; runtimeId?: string }>();
  const output = await run("ps", ["-A", "-E", "-ww", "-o", "pid=,command="]);
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s(.*)$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const row = rows.get(pid);
    const full = match[2]!.trimStart();
    // Only the suffix after the plain command line is environment.
    if (!row || !full.startsWith(row.command)) continue;
    const suffix = full.slice(row.command.length);
    if (!suffix.includes("LOOM_")) continue;
    const tags = tagsFromEnvironment(suffix.split(" "));
    if (tags.runtimeId !== undefined) result.set(pid, tags);
  }
  return result;
}

async function linuxEnvironmentTags(
  rows: Map<number, ParsedRow>,
  uid: number | undefined,
): Promise<Map<number, { runId?: string; runtimeId?: string }>> {
  const result = new Map<number, { runId?: string; runtimeId?: string }>();
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
      const result = new Map<number, number[]>();
      if (pids.length === 0) return result;
      let output: string;
      try {
        output = await run("lsof", [
          "-nP",
          "-a",
          "-iTCP",
          "-sTCP:LISTEN",
          "-p",
          pids.join(","),
          "-Fpn",
        ]);
      } catch {
        return result;
      }
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
