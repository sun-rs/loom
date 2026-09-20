/** Read compatibility only. New commands/projections use agentId; IDs never change. */
export function canonicalAgentIdField<T>(value: T): T {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return value;
  const record = { ...(value as Record<string, unknown>) };
  for (const key of [
    "agentDefinitionRevision",
    "currentRevision",
    "definition",
  ] as const) {
    if (record[key] !== undefined && typeof record[key] === "object") {
      record[key] = canonicalAgentIdField(record[key]);
    }
  }
  if (!Object.hasOwn(record, "agentDefinitionId")) return record as T;
  if (
    record.agentId !== undefined &&
    record.agentId !== record.agentDefinitionId
  )
    throw new Error("Conflicting agentId and legacy agentDefinitionId");
  const { agentDefinitionId, ...rest } = record;
  return { ...rest, agentId: agentDefinitionId } as T;
}
