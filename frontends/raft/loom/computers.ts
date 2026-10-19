import type { LocalComputerObservation } from "@rah-os/protocol";
export function computerStatus(
  observation:
    | Pick<LocalComputerObservation, "status" | "observedAt" | "staleAfterMs">
    | undefined,
  now: number,
): LocalComputerObservation["status"] {
  if (!observation) return "unknown";
  const observed = Date.parse(observation.observedAt);
  if (!Number.isFinite(observed) || now - observed >= observation.staleAfterMs)
    return "unknown";
  return observation.status;
}
export const computerStatusLabels = {
  online: "在线",
  draining: "正在停止",
  offline: "离线",
  unknown: "状态未知",
};
