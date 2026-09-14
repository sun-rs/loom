/** Compact chat identity, independent of runtime and catalog display names. */
export function chatModelIdentifier(model: {
  modelId: string;
  provider?: string;
}): string {
  const modelId = model.modelId.trim();
  const provider = model.provider?.trim();
  return provider && !modelId.startsWith(`${provider}/`)
    ? `${provider}/${modelId}`
    : modelId;
}
