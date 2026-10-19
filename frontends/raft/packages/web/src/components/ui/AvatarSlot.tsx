import type { ReactElement, ReactNode } from "react";
import { User } from "lucide-react";
import { Avatar, AvatarBadge, AvatarFallback } from "raft-ui";
import type { AvatarSize } from "raft-ui";
import { AgentAvatar } from "../agent/PixelAvatar";
import GravatarAvatar from "../member/GravatarAvatar";

/** Structural port of v1.21.22 NU: raft-ui owns frame dimensions and borders.
 * Legacy context names below are aliases only, not a second size recipe.
 */
const CONTEXT_SIZE = {
  "profile-hero": "xl",
  "profile-tile": "lg",
  "account-tile": "lg",
  "mention-card": "lg",
  "panel-header": "md",
  "message-row": "md",
  "list-row": "md",
  "compact-row": "sm",
  "creator-link": "xs",
  "sidebar-list": "2xs",
  "compact-list": "xs",
  "face-stack": "xs",
  "preview-mini": "3xs",
  "surface-list": "md",
  "members-row": "sm",
} satisfies Record<string, AvatarSize>;
export type AvatarContext = keyof typeof CONTEXT_SIZE;
const CONTENT_SIZE = {
  xl: { size: 96, icon: 48 },
  lg: { size: 52, icon: 24 },
  md: { size: 36, icon: 16 },
  sm: { size: 24, icon: 14 },
  xs: { size: 16, icon: 12 },
  "2xs": { size: 16, icon: 10 },
  "3xs": { size: 11, icon: 9 },
};

export interface AvatarSlotProps {
  context: AvatarContext;
  /** Entity kind — controls which inner renderer is used. */
  type: "agent" | "human" | "server" | "app";
  /** Agent's avatarUrl (`pixel:*` key or uploaded image URL). Used when
   *  `type="agent"`. */
  agentAvatarUrl?: string | null;
  /** Human's gravatar hash. Used when `type="human"`. */
  gravatarHash?: string | null;
  /** Human's uploaded avatar URL. Used before Gravatar when `type="human"`. */
  humanAvatarUrl?: string | null;
  /** Server's uploaded avatar URL. Used when `type="server"`. */
  serverAvatarUrl?: string | null;
  /** Server initial placeholder. Used when `type="server"` has no avatar. */
  serverInitial?: string | null;
  /** App logo URL. Used when `type="app"`. */
  appAvatarUrl?: string | null;
  /** App initials placeholder. Used when `type="app"` has no logo. */
  appInitials?: string | null;
  /** Optional email — GravatarAvatar derives a hash client-side when
   *  `gravatarHash` is missing. Used when `type="human"`. */
  email?: string | null;
  /** When `type="human"`, render a static User-icon placeholder instead of
   *  attempting a Gravatar lookup. Use when no gravatar identity is known. */
  humanPlaceholder?: boolean;
  /** Optional corner indicator. When present, the identity frame is rendered
   *  by raft-ui Avatar and the indicator is mounted through AvatarBadge so
   *  size and bottom-right placement stay canonical across call sites. */
  badge?: ReactElement;
  /** Trusted preview content can supply an uncommitted upload without replacing the themed frame. */
  children?: ReactNode;
  /** Additional classes — appended to the outer container. Useful for
   *  callsite-specific tweaks (e.g. `grayscale opacity-60` for deactivated
   *  agents). Do not use this to add a background color. */
  className?: string;
}

export function AvatarImageWithFallback({
  src,
  fallback,
  alt = "",
  className = "h-full w-full object-cover",
}: {
  src?: string | null;
  fallback: ReactNode;
  alt?: string;
  className?: string;
}) {
  return (
    <>
      {/* Positioned fallbacks paint above ordinary in-flow children. Give both
          layers an explicit stack order so a valid avatar always covers its
          placeholder; hiding the broken image reveals the fallback again. */}
      <span className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        {fallback}
      </span>
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          className={`relative z-[1] ${className}`}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </>
  );
}

export default function AvatarSlot({
  context,
  type,
  agentAvatarUrl,
  gravatarHash,
  humanAvatarUrl,
  serverAvatarUrl,
  serverInitial,
  appAvatarUrl,
  appInitials,
  email,
  humanPlaceholder,
  badge,
  children,
  className = "",
}: AvatarSlotProps) {
  const size = CONTEXT_SIZE[context];
  const spec = CONTENT_SIZE[size];
  let content: ReactNode;
  if (children !== undefined) {
    content = children;
  } else if (type === "agent") {
    content = <AgentAvatar avatarUrl={agentAvatarUrl ?? null} size={spec.size} className="!h-full !w-full" />;
  } else if (type === "server" || type === "app") {
    const initials = type === "server" ? serverInitial || "S" : appInitials || "A";
    const fallback = initials.trim().slice(0, type === "server" ? 1 : 2).toUpperCase() || (type === "server" ? "S" : "A");
    content = <AvatarImageWithFallback src={type === "server" ? serverAvatarUrl : appAvatarUrl} fallback={fallback} />;
  } else if (humanPlaceholder) {
    content = <User />;
  } else {
    content = (
      <GravatarAvatar
        avatarUrl={humanAvatarUrl ?? null}
        gravatarHash={gravatarHash ?? null}
        email={email ?? undefined}
        size={spec.size}
        iconSize={spec.icon}
      />
    );
  }

  const server = type === "server";
  return (
    <Avatar
      size={size}
      type={type === "agent" ? "agent" : "human"}
      className={`${server ? "bg-sticker-ink" : ""} ${className}`.trim()}
      data-avatar-context={context}
      data-avatar-type={type}
    >
      <AvatarFallback className={`relative overflow-hidden ${server ? "bg-sticker-ink text-primary" : ""}`}>
        {content}
      </AvatarFallback>
      {badge ? (
        <AvatarBadge render={<span />} className="flex rounded-[2px] [&>span]:h-full [&>span]:w-full">
          {badge}
        </AvatarBadge>
      ) : null}
    </Avatar>
  );
}
