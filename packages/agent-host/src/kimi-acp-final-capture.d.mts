import type { KimiFinalWire } from "./kimi-acp-final-output.js";
export function captureKimiWire(path: string): KimiFinalWire;
export function readKimiWireSuffix(
  baseline: KimiFinalWire,
): KimiFinalWire & { suffix: string };
