// Compatibility only: the retired uppercase option must not leak to the DOM.
import OfficialSectionEyebrow, { type SectionEyebrowProps as OfficialProps } from "@loom/raft-web-source/SectionEyebrow";
export type { SectionEyebrowTone } from "@loom/raft-web-source/SectionEyebrow";
export type SectionEyebrowProps = OfficialProps & { uppercase?: boolean };
export default function SectionEyebrow({ uppercase: _legacyUppercase, ...props }: SectionEyebrowProps) {
  return <OfficialSectionEyebrow {...props} />;
}
