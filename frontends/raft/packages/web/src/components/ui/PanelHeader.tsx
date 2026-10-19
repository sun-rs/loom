import { ArrowLeft } from "lucide-react";
import { isHostShell } from "../../embed";
import type { HTMLAttributes, ReactNode } from "react";
import {
  PanelAction,
  PanelActions,
  PanelHeader,
  PanelHeaderContent,
  PanelHeaderIcon,
  PanelHeading,
  PanelMeta,
  PanelStatus,
  PanelTitle,
} from "raft-ui";

// React's `HTMLAttributes` doesn't expose `data-*` keys in TS, so widen
// passthrough prop types with a string-key index signature so callsites
// can attach `data-testid` etc. without casting.
type DivPassthroughProps = HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
type ButtonPassthroughProps = HTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;

const NO_CONTAINER_PROPS: DivPassthroughProps = {};

/** Current official NW composition (v1.21.22). The recipe owns surface styling.
 * Empty compatibility export keeps existing profile callers source-compatible. */
export const PROFILE_HEADER_SURFACE_CLASS = "";
export const PROFILE_HANDLE_SIZE_CLASS = "font-mono";
const HEADER_ICON_TONE = {
  location: "",
  neutral: "border-transparent bg-fill-muted text-foreground-muted ring-0",
} as const;

/** Shared official header; Loom's approved compact mobile grid is retained. */
export interface AppPanelHeaderProps {
  /** Title — primary text or custom node. Wrapped in `<h2 truncate>`.
   *  Use `titleSlot` instead for non-text titles. */
  title?: ReactNode;
  /** Replaces the entire title block (h2 + subtitle). Use this for
   *  non-text titles like search inputs. When provided, `title` /
   *  `subtitle` / `titleSuffix` / `subtitleMultiline` are ignored. */
  titleSlot?: ReactNode;
  /** Optional inline node rendered next to the H2 title (e.g. status
   *  dot, activity indicator). Lives OUTSIDE the truncate envelope so
   *  it never gets cut off. Inside the same flex row as the H2. */
  titleSuffix?: ReactNode;
  /** Optional subtitle line below the title (font-mono, text-xs,
   *  text-foreground-muted). Truncated to single line by default. */
  subtitle?: ReactNode;
  /** When true, subtitle is allowed to wrap to multiple lines instead
   *  of single-line truncation. Used for channel descriptions. */
  subtitleMultiline?: boolean;
  /** Extra classes for the subtitle element (e.g. the profile handle size
   *  tier — see PROFILE_HANDLE_SIZE_CLASS). */
  subtitleClassName?: string;
  /** Optional icon node (e.g. `<Bookmark size={18} />`) — rendered
   *  inside the size-icon-header container, desktop-only (md:flex). */
  icon?: ReactNode;
  /** Semantic icon surface from the official header composition. */
  iconTone?: "location" | "neutral";
  /** Pre-wrapped icon slot — bypasses the size-icon-header /
   *  native icon surface. Pass elements that bring their own
   *  container (e.g. `<AvatarSlot context="panel-header" ... />`).
   *  Mutually exclusive with `icon`. Honors the same visibility
   *  rules as `icon` (mobile hide unless `iconAlwaysVisible`). */
  iconSlot?: ReactNode;
  /** Marks what the icon slot holds. `"avatar"` declares an identity
   *  avatar: the identity background is dropped (recipe reads
   *  `data-icon-kind="avatar"` → bg-transparent) so a round avatar
   *  does not sit on a square. Glyph icons keep the chip. */
  iconKind?: "avatar";
  /** Whether the icon is visible on every viewport. Default `false`
   *  matches "non-identity" surfaces (Saved / Release Notes / Settings)
   *  that hide the icon on mobile to save header space. Set to `true`
   *  for "identity" surfaces (Human / Agent / Machine detail panels)
   *  where the icon (avatar / mark) IS the identity and must stay
   *  visible at every viewport. */
  iconAlwaysVisible?: boolean;
  /** Optional mobile back-chevron callback. When provided, renders a
   *  `btn-brutal-sm` chevron-left button visible only on mobile
   *  (`md:hidden` by default; ThreadPanel uses `lg:hidden` because
   *  it's an overlay panel with a different breakpoint contract). */
  onMobileBack?: () => void;
  /** Tailwind breakpoint at which the mobile back chevron hides.
   *  Default `"md"`. Use `"lg"` for ThreadPanel-style overlay panels
   *  that show their back chevron longer (because the parent column
   *  layout collapses later). */
  mobileBreakpoint?: "md" | "lg";
  /** Additional props passed to the mobile back button (e.g.
   *  `data-testid`, `title` for tooltip). */
  mobileBackProps?: ButtonPassthroughProps;
  /** Back buttons are responsive by default: they disappear once the
   *  parent/detail columns are visible side-by-side. Drawer-internal page
   *  stacks still need a structural Back control on desktop, because it
   *  returns to the previous page inside the same drawer rather than closing
   *  the drawer. */
  backButtonVisibility?: "responsive" | "always";
  /** Additional props passed to the title-block wrapper (e.g.
   *  `data-testid`, `onClick` for header-title click handlers,
   *  `title` for tooltip). */
  titleClickProps?: DivPassthroughProps;
  /** Additional props passed to the outer header container (e.g.
   *  `data-testid`, `title` for tooltip, additional `className`). */
  containerProps?: DivPassthroughProps;
  /** Right-aligned action slot — typically a row of `Button`s
   *  with `gap-1.5`. */
  actions?: ReactNode;
}

export default function AppPanelHeader({
  title,
  titleSlot,
  titleSuffix,
  subtitle,
  subtitleMultiline = false,
  subtitleClassName,
  icon,
  iconTone = "neutral",
  iconSlot,
  iconKind,
  iconAlwaysVisible = false,
  onMobileBack,
  mobileBreakpoint = "md",
  mobileBackProps,
  backButtonVisibility = "responsive",
  titleClickProps,
  containerProps,
  actions,
}: AppPanelHeaderProps) {
  // HOST-SHELL EMBED: the native WebView already draws a title bar, so web must not
  // draw a second one. But the ACTIONS must not die with the title — Computers' "+"
  // and Connected Apps' "Register app" live in this slot, and dropping the whole
  // header (which is what the pre-contract `embed=1` did) silently deletes them.
  // So: no title, no back button, no chrome — actions only, in a compact row.
  //
  // Read synchronously at module load (see embed.ts): a `useEffect` would paint the
  // header on the first frame and remove it on the second — a visible flash that
  // every functional test would still call green.
  if (isHostShell()) {
    if (!actions) return null;
    return (
      <div
        {...containerProps}
        data-testid="panel-header-embed-actions"
        data-embed-shell="host"
        className={`flex items-center justify-end gap-2 px-5 pt-3 ${containerProps?.className ?? ""}`}
      >
        {actions}
      </div>
    );
  }

  const mobileHiddenClass = backButtonVisibility === "always"
    ? ""
    : mobileBreakpoint === "lg"
      ? "lg:hidden"
      : "md:hidden";
  const iconVisibilityClass = iconAlwaysVisible
    ? `flex ${onMobileBack ? "" : "max-md:col-start-1"}`
    : mobileBreakpoint === "lg"
    ? "hidden lg:flex"
    : "hidden md:flex";
  // RUI's mobile header has four explicit columns: Back / identity / title /
  // actions. Hidden identity slots must not leave the title in the Back cell.
  const mobileContentClass = (icon || iconSlot) && iconAlwaysVisible
    ? onMobileBack ? "max-md:col-start-3" : "max-md:col-start-2 max-md:col-span-2"
    : onMobileBack ? "max-md:col-start-2 max-md:col-span-2" : "max-md:col-span-3";
  const { className: containerExtraClass, ...containerRest } = containerProps ?? NO_CONTAINER_PROPS;
  return (
    <PanelHeader
      {...containerRest}
      // stdrc 2026-05-14 #wg-theme:16123203 "确保同类页面用的组件都是
      // 长得左边 (BEFORE) 那样" — flat `gap-3 px-5` everywhere, no narrow-
      // viewport shrink. Earlier 2026-05-10 rule (`gap-2 px-3 sm:gap-3
      // sm:px-5`) was reverted: stdrc preferred the wider padding seen on
      // the old hand-rolled MobileComputersPanel, so every Settings sub-page
      // (Account / Browser / Server / Computers) now reads the same width
      // at every breakpoint.
      className={containerExtraClass}
    >
      {onMobileBack && (
        <PanelAction
          {...mobileBackProps}
          onClick={onMobileBack}
          className={`max-md:col-start-1 max-md:row-start-1 ${mobileHiddenClass} ${mobileBackProps?.className ?? ""}`}
        >
          <ArrowLeft size={22} />
        </PanelAction>
      )}
      {icon && (
        <PanelHeaderIcon
          className={`${iconVisibilityClass} ${HEADER_ICON_TONE[iconTone]}`}
        >
          {icon}
        </PanelHeaderIcon>
      )}
      {iconSlot && (
        <PanelHeaderIcon className={iconVisibilityClass} data-icon-kind={iconKind}>
          {iconSlot}
        </PanelHeaderIcon>
      )}
      {titleSlot ? (
        <PanelHeaderContent className={`min-w-0 flex-1 ${mobileContentClass}`}>{titleSlot}</PanelHeaderContent>
      ) : (
        <PanelHeaderContent
          {...titleClickProps}
          className={`min-w-0 flex-1 ${mobileContentClass} ${titleClickProps?.className ?? ""}`}
        >
          <PanelHeading>
            <PanelTitle
              render={(
                <h2>
                  {title}
                </h2>
              )}
            />
            {titleSuffix && <PanelStatus>{titleSuffix}</PanelStatus>}
          </PanelHeading>
          {subtitle && (
            <PanelMeta
              render={<p />}
              className={`${
                subtitleMultiline ? "" : "truncate"
              }${subtitleClassName ? ` ${subtitleClassName}` : ""}`}
            >
              {subtitle}
            </PanelMeta>
          )}
        </PanelHeaderContent>
      )}
      {actions && (
        <PanelActions>{actions}</PanelActions>
      )}
    </PanelHeader>
  );
}
