/** Compact chat identity, independent of runtime and catalog display names. */
export function chatModelIdentifier(model: {
  modelId: string;
  provider?: string;
}): string {
  // A missing runtime catalog exposes the stored local binding instead.
  // Strip only its transport namespace; preserve the provider/model identity.
  return model.modelId.trim().replace(/^local:[^:]+\/v\d+:/u, "");
}
