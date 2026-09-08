function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export function comparisonConditions(official, local) {
  const differences = [];
  for (const key of ["width", "height", "dpr", "zoom"])
    if (
      !Number.isFinite(official?.environment?.[key]) ||
      official.environment[key] <= 0 ||
      official.environment[key] !== local?.environment?.[key]
    )
      differences.push(`environment.${key}`);
  for (const key of ["state", "dataShape"])
    if (
      official?.[key] == null ||
      local?.[key] == null ||
      JSON.stringify(canonical(official[key])) !==
        JSON.stringify(canonical(local[key]))
    )
      differences.push(key);
  return {
    status: differences.length
      ? "preconditions-differ"
      : "human-review-required",
    differences,
  };
}
