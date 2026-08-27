import { z } from "zod";

export const IdentifierSchema = z.string().min(1);
export const TimestampSchema = z.iso.datetime({ offset: true });
export const ContentDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export type ContentDigest = z.infer<typeof ContentDigestSchema>;

export function rejectDuplicateStrings(
  values: readonly string[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `duplicate value: ${value}`,
        path: [index],
      });
    }
    seen.add(value);
  });
}
