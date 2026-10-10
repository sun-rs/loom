// Integrity only: an HTTP429 body can be fully archived, yet is not model usage.
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function readPassiveHttpCapture(root) {
  const errors = [],
    attempts = [],
    processes = [];
  let directories;
  try {
    directories = readdirSync(root, { withFileTypes: true });
  } catch {
    return {
      complete: false,
      errors: ["capture root unavailable"],
      processes,
      attempts,
    };
  }
  for (const dir of directories) {
    if (!dir.isDirectory()) {
      errors.push("unexpected capture entry");
      continue;
    }
    const directory = join(root, dir.name);
    let rows;
    try {
      rows = readFileSync(join(directory, "events.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
    } catch {
      errors.push(`${dir.name}: unreadable or malformed events; seal unknown`);
      continue;
    }
    const starts = rows.filter((r) => r.type === "start");
    const ends = rows.filter((r) => r.type === "end");
    const seals = rows.filter((r) => r.type === "process-exit");
    const initial = rows.filter((r) => r.type === "process-start");
    if (initial.length !== 1 || initial[0].processId !== dir.name)
      errors.push(`${dir.name}: invalid process identity`);
    if (seals.length !== 1 || rows.at(-1) !== seals[0])
      errors.push(`${dir.name}: missing or invalid process seal`);
    const seal = seals[0];
    if (
      seal &&
      (seal.fault ||
        seal.active?.length ||
        seal.ignoredAttempts ||
        seal.attempts !== starts.length)
    )
      errors.push(`${dir.name}: incomplete process census`);
    if (rows.some((r) => r.type === "gap"))
      errors.push(`${dir.name}: capture gap`);
    if (
      new Set(starts.map((r) => r.id)).size !== starts.length ||
      ends.length !== starts.length
    )
      errors.push(`${dir.name}: attempt identity/census mismatch`);
    processes.push({ directory, seal: seal ?? null });
    for (const start of starts) {
      if (
        typeof start.id !== "string" ||
        !start.id.startsWith(dir.name + "-") ||
        !/^[a-f0-9-]+$/.test(start.id)
      ) {
        errors.push(`${dir.name}: invalid attempt identity`);
        continue;
      }
      const matches = ends.filter((e) => e.id === start.id);
      const end = matches.length === 1 ? matches[0] : {};
      const attempt = {
        ...start,
        ...end,
        startedAt: start.time,
        processDirectory: directory,
      };
      let valid =
        matches.length === 1 &&
        end.captureComplete === true &&
        end.requestSent === true &&
        end.responseEnded === true &&
        end.terminal === "trailers";
      for (const side of ["request", "response"]) {
        const path = join(directory, `${start.id}.${side}`);
        attempt[`${side}Path`] = path;
        try {
          const stat = lstatSync(path);
          if (!stat.isFile() || stat.mode & 0o077)
            throw new Error("not a private regular file");
          const bytes = readFileSync(path);
          if (
            end[`${side}Bytes`] !== bytes.length ||
            end[`${side}ArchivedBytes`] !== bytes.length ||
            end[`${side}Sha256`] !==
              createHash("sha256").update(bytes).digest("hex")
          )
            valid = false;
        } catch {
          valid = false;
        }
      }
      attempt.captureComplete = valid;
      if (!valid)
        errors.push(`${start.id}: incomplete or corrupt attempt archive`);
      attempts.push(attempt);
    }
  }
  attempts.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  if (!attempts.length) errors.push("no observed matching requests");
  return { complete: errors.length === 0, errors, processes, attempts };
}
