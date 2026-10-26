import { useMobilePageBack } from "../../../../../loom/MobilePageNavigation";
import OfficialPanelHeader, {
  type AppPanelHeaderProps,
  PROFILE_HANDLE_FONT_CLASS,
} from "@loom/raft-web-source/PanelHeader";
export type { AppPanelHeaderProps } from "@loom/raft-web-source/PanelHeader";
export { PROFILE_HANDLE_FONT_CLASS };
// Compatibility names for older profile callers; no visual recipe lives here.
export const PROFILE_HEADER_SURFACE_CLASS = "";
export const PROFILE_HANDLE_SIZE_CLASS = PROFILE_HANDLE_FONT_CLASS;
/** Preserve the owner-approved compact mobile layout through native prop slots.
 * Upstream renders the complete header, including title, status, actions and embed mode. */
export default function PanelHeader(props: AppPanelHeaderProps) {
  const secondaryBack = useMobilePageBack();
  const onMobileBack = secondaryBack ?? props.onMobileBack;
  const identity = Boolean((props.icon || props.iconSlot) && props.iconAlwaysVisible);
  return (
    <OfficialPanelHeader
      {...props}
      onMobileBack={onMobileBack}
      mobileBackProps={secondaryBack ? { "aria-label": "返回上一页" } : props.mobileBackProps}
      containerProps={{
        ...props.containerProps,
        "data-loom-header-identity": identity ? "true" : "false",
        "data-loom-header-back": onMobileBack ? "true" : "false",
      }}
    />
  );
}
