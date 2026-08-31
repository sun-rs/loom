import type { InputRequest } from "@rah-os/protocol";

export function pendingInputRequestsForHuman(input: {
  inputRequests: readonly InputRequest[];
  principalId: string | undefined;
}): InputRequest[] {
  if (input.principalId === undefined) return [];
  const byId = new Map<string, InputRequest>();
  for (const request of input.inputRequests) {
    if (
      request.state === "pending" &&
      request.responderId === input.principalId
    ) {
      byId.set(request.inputRequestId, request);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      left.inputRequestId.localeCompare(right.inputRequestId),
  );
}
