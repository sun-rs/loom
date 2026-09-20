import { useEffect, useRef, useState, type ReactNode } from "react";

// Raft G9: 5s display lifetime; the server's undo expiry remains a hard limit.
export function ThreadFollowerToast({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}) {
  const remaining = useRef(5000);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const started = performance.now();
    const timer = window.setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - started),
      );
    };
  }, [hovered, focused]);
  return (
    <div
      className="rah-thread-follower-undo"
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      {children}
    </div>
  );
}
