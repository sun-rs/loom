import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { ConflictError } from "@rah-os/kernel";
import {
  RuntimeConcurrencySettingsSchema,
  RuntimeConcurrencyUpdateSchema,
  type RuntimeConcurrencySettings as RuntimeConcurrencyView,
  type RuntimeConcurrencyUpdate,
} from "@rah-os/protocol";
import { z } from "zod";

/**
 * Per-CLI run cap default. No provider documents a concurrent-session limit
 * for its CLI (Claude Code, Codex, Kimi, OpenCode), so this is a conservative
 * operating value, not a measured bound; the Human raises it at runtime.
 */
export const DEFAULT_PER_CLI_MAX_CONCURRENT_RUNS = 4;

const State = z
  .object({
    revision: z.number().int().nonnegative(),
    maxConcurrentRuns: z.number().int().min(1).max(64).optional(),
    maxConcurrentStarts: z.number().int().min(1).max(64).optional(),
    minStartIntervalMs: z.number().int().min(0).max(60_000).optional(),
    // Keyed by RuntimeProfile; entries of a CLI that is not configured now are
    // kept so reinstalling it restores the Human's choice.
    runtimeMaxConcurrentRuns: z
      .record(z.string().min(1), z.number().int().min(1).max(64))
      .optional(),
  })
  .strict();

export type RuntimeConcurrencyRuntime = {
  offerMaxConcurrent: number;
  runtimeOfferId: string;
  runtimeProfileId: string;
};

/**
 * Single daemon owner of the Human's concurrency settings. It persists them
 * (owner-private, atomic replace) and notifies the appliers (Kernel placement
 * caps, Host lanes, warm pool, start gate); it holds no work or queue itself.
 */
export class RuntimeConcurrencySettings {
  readonly path: string;
  readonly #defaults: {
    maxConcurrentRuns: number;
    maxConcurrentStarts: number;
    minStartIntervalMs: number;
  };
  readonly #runtimes: readonly RuntimeConcurrencyRuntime[];
  readonly #listeners: ((view: RuntimeConcurrencyView) => void)[] = [];
  #state: z.infer<typeof State>;

  constructor(input: {
    defaults: {
      maxConcurrentRuns: number;
      maxConcurrentStarts: number;
      minStartIntervalMs: number;
    };
    path: string;
    runtimes: readonly RuntimeConcurrencyRuntime[];
  }) {
    this.path = input.path;
    this.#defaults = input.defaults;
    this.#runtimes = input.runtimes;
    this.#state = existsSync(input.path)
      ? State.parse(JSON.parse(readFileSync(input.path, "utf8")))
      : { revision: 0 };
  }

  onChange(listener: (view: RuntimeConcurrencyView) => void): void {
    this.#listeners.push(listener);
  }

  read(): RuntimeConcurrencyView {
    const state = this.#state;
    return RuntimeConcurrencySettingsSchema.parse({
      maxConcurrentRuns:
        state.maxConcurrentRuns ?? this.#defaults.maxConcurrentRuns,
      maxConcurrentStarts:
        state.maxConcurrentStarts ?? this.#defaults.maxConcurrentStarts,
      minStartIntervalMs:
        state.minStartIntervalMs ?? this.#defaults.minStartIntervalMs,
      revision: state.revision,
      runtimes: this.#runtimes.map((runtime) => ({
        ...runtime,
        maxConcurrentRuns:
          state.runtimeMaxConcurrentRuns?.[runtime.runtimeProfileId] ??
          DEFAULT_PER_CLI_MAX_CONCURRENT_RUNS,
      })),
    });
  }

  update(raw: RuntimeConcurrencyUpdate): RuntimeConcurrencyView {
    const input = RuntimeConcurrencyUpdateSchema.parse(raw);
    if (input.expectedRevision !== this.#state.revision)
      throw new ConflictError(
        "Concurrency settings revision changed; reload settings",
      );
    const runtimeLimits = { ...this.#state.runtimeMaxConcurrentRuns };
    for (const runtime of input.runtimes ?? []) {
      if (
        !this.#runtimes.some(
          ({ runtimeProfileId }) =>
            runtimeProfileId === runtime.runtimeProfileId,
        )
      )
        throw new ConflictError(
          `RuntimeProfile ${runtime.runtimeProfileId} is not configured on this Host`,
        );
      runtimeLimits[runtime.runtimeProfileId] = runtime.maxConcurrentRuns;
    }
    const next = State.parse({
      ...this.#state,
      ...(input.maxConcurrentRuns === undefined
        ? {}
        : { maxConcurrentRuns: input.maxConcurrentRuns }),
      ...(input.maxConcurrentStarts === undefined
        ? {}
        : { maxConcurrentStarts: input.maxConcurrentStarts }),
      ...(input.minStartIntervalMs === undefined
        ? {}
        : { minStartIntervalMs: input.minStartIntervalMs }),
      revision: this.#state.revision + 1,
      runtimeMaxConcurrentRuns: runtimeLimits,
    });
    this.#persist(next);
    this.#state = next;
    const view = this.read();
    for (const listener of this.#listeners) listener(view);
    return view;
  }

  #persist(next: z.infer<typeof State>): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(next), {
        flag: "wx",
        mode: 0o600,
      });
      const file = openSync(temporary, "r");
      try {
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      renameSync(temporary, this.path);
      const directory = openSync(dirname(this.path), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
