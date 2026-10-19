/**
 * Shared section label. Original Raft component retained; typography adopted
 * from production v1.21.22 $U/wXe/TXe (see page-adoption.json).
 * Use semantic hint/muted/ink tones, without legacy uppercase/tracking overrides.
 */

import type { LabelHTMLAttributes, ReactNode } from "react";

// v1.21.22 $U/wXe/TXe: native semantic typography; legacy uppercase prop is retained for caller compatibility only.
const BASE_CLASS = "text-footnote font-bold";
const TONES = {hint:"text-foreground-hint",muted:"text-foreground-muted",ink:"text-foreground"};

export type SectionEyebrowProps = {
  /** HTML element to render. Default `"span"`. Use `"div"` for block-level
   *  eyebrows (e.g. with `mb-3`), `"label"` for form field labels. */
  as?: "span" | "div" | "label";
  /** Additional classes — appended to the base token. Useful for margin
   *  (`mb-3`), padding (`px-3 py-1.5`), background (`bg-white/50`), or
   *  color overrides (`!text-black`). */
  className?: string;
  /** Eyebrow text / nodes. */
  children?: ReactNode;
  /** When `as="label"`, forward to the `<label htmlFor>` attribute. */
  htmlFor?: LabelHTMLAttributes<HTMLLabelElement>["htmlFor"];
  /** Legacy caller compatibility only; native labels now preserve source case. */
  uppercase?: boolean;
  tone?: keyof typeof TONES;
};

export default function SectionEyebrow({
  as: Tag = "span",
  className = "",
  children,
  htmlFor,
  tone = "hint",
}: SectionEyebrowProps) {
  const cls = `${BASE_CLASS} ${TONES[tone]} ${className}`.trim();
  if (Tag === "label") {
    return (
      <label className={cls} htmlFor={htmlFor}>
        {children}
      </label>
    );
  }
  if (Tag === "div") {
    return <div className={cls}>{children}</div>;
  }
  return <span className={cls}>{children}</span>;
}
