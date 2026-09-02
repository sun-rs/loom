import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";

import {
  RAFT_RUNTIME_INSPECTOR_CLOSE_DELAY_MS,
  RAFT_RUNTIME_INSPECTOR_OPEN_DELAY_MS,
  runtimeInspectorRows,
} from "../computer-runtime-inspector-model.ts";
import { floatingContextMenuPosition } from "../floating-context-menu-model.ts";
import { Icon } from "./icon.tsx";

export function ComputerRuntimeInspector({
  children,
  className,
  runtime,
}: {
  children: ReactNode;
  className: string;
  runtime: LocalRuntimeInventoryEntry;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pinned = useRef(false);
  const suppressNextFocusOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [position, setPosition] = useState({ x: 8, y: 8 });

  const cancelOpen = useCallback(() => clearTimeout(openTimer.current), []);
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const close = useCallback(
    (restoreFocus = false) => {
      cancelOpen();
      cancelClose();
      pinned.current = false;
      setOpen(false);
      if (restoreFocus) {
        const trigger = triggerRef.current;
        if (trigger !== null && document.activeElement !== trigger) {
          suppressNextFocusOpen.current = true;
        }
        queueMicrotask(() => trigger?.focus());
      }
    },
    [cancelClose, cancelOpen],
  );
  const show = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const scheduleOpen = useCallback(() => {
    cancelClose();
    cancelOpen();
    openTimer.current = setTimeout(show, RAFT_RUNTIME_INSPECTOR_OPEN_DELAY_MS);
  }, [cancelClose, cancelOpen, show]);
  const scheduleClose = useCallback(() => {
    cancelOpen();
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!pinned.current) setOpen(false);
    }, RAFT_RUNTIME_INSPECTOR_CLOSE_DELAY_MS);
  }, [cancelClose, cancelOpen]);

  useEffect(() => {
    const resize = () => {
      setMobile(window.innerWidth < 768);
      if (open && !pinned.current) setOpen(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const pointerDown = (event: PointerEvent) => {
      if (!pinned.current) return;
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      )
        close(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
    };
  }, [close, open]);

  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [cancelClose, cancelOpen],
  );

  useLayoutEffect(() => {
    if (!open || mobile) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    setPosition(
      floatingContextMenuPosition({
        anchorX: anchor.left,
        anchorY: anchor.bottom + 8,
        menuHeight: bounds.height,
        menuWidth: bounds.width,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }),
    );
  }, [mobile, open]);

  if (!runtime.available) return <span className={className}>{children}</span>;
  const panel = (
    <div
      aria-label={`${runtime.displayName} 本机 Runtime 详情`}
      className={`rah-computer-runtime-inspector${mobile ? " is-mobile" : ""}`}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      ref={panelRef}
      role="dialog"
      style={
        mobile
          ? undefined
          : ({ left: position.x, top: position.y } as CSSProperties)
      }
    >
      <header>
        <div>
          <strong>{runtime.displayName}</strong>
          <span>本机探测</span>
        </div>
        <button
          aria-label="关闭 Runtime 详情"
          onClick={() => close(true)}
          type="button"
        >
          <Icon name="x" />
        </button>
      </header>
      <dl>
        {runtimeInspectorRows(runtime).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p>
        这里显示 daemon 已验证的本机 Runtime 证据，不包含 Provider
        账号配额或凭据。
      </p>
    </div>
  );
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${runtime.displayName} Runtime 详情`}
        className={className}
        onBlur={scheduleClose}
        onClick={() => {
          pinned.current = true;
          show();
        }}
        onFocus={() => {
          if (suppressNextFocusOpen.current) {
            suppressNextFocusOpen.current = false;
            return;
          }
          show();
        }}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        ref={triggerRef}
        type="button"
      >
        {children}
      </button>
      {open &&
        createPortal(
          mobile ? (
            <div
              className="rah-computer-runtime-inspector-layer"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) close(false);
              }}
            >
              {panel}
            </div>
          ) : (
            panel
          ),
          document.body,
        )}
    </>
  );
}
