/**
 * Loom evo throwaway console (docs/evo/status.zh-CN.md §44). Batch 1 is
 * read-only. Deleted in phase 4 with the gateway console branch.
 *
 * The gateway CSP omits `unsafe-eval`; Zod probes `Function("")` while its
 * module evaluates unless the shared global config is already jitless (same
 * reason as apps/web/src/main.tsx). Set it before importing anything that
 * imports Zod.
 */
import "./style.css";

const zodGlobal = globalThis as typeof globalThis & {
  __zod_globalConfig?: Record<string, unknown>;
};
zodGlobal.__zod_globalConfig = {
  ...zodGlobal.__zod_globalConfig,
  jitless: true,
};

void import("./app.ts");
