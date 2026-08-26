export type Row = Record<string, null | number | bigint | string | Uint8Array>;

export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`expected ${key} to be text`);
  return value;
}

export function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`expected ${key} to be text`);
  return value;
}

export function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`expected ${key} to be an integer`);
  }
  return value;
}

export function nullableInteger(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`expected ${key} to be an integer`);
  }
  return value;
}

export function jsonObject(row: Row, key: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text(row, key));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`expected ${key} to contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function stringArray(row: Row, key: string): string[] {
  const parsed: unknown = JSON.parse(text(row, key));
  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string")
  ) {
    throw new Error(`expected ${key} to contain strings`);
  }
  return parsed;
}
