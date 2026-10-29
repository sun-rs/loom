import { useCallback, useEffect, useRef, useState } from "react";
import { DescriptionList, Status } from "raft-ui";
import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives";
import { useViewportClamp } from "../packages/web/src/components/layout/useViewportClamp";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter";
import { InfoRow } from "./OfficialProfile.generated";
import {
  OfficialRuntimeInfoBody,
  OfficialRuntimeInfoFrame,
  HOVER_OPEN_DELAY_MS,
  HOVER_CLOSE_DELAY_MS,
} from "./OfficialRuntimeInfo.generated";
type Runtime = LocalRuntimeInventoryResponse["runtimes"][number];
/** Host inventory is authoritative for detection, not account login/remaining quota. */
export default function RuntimeInfoChip({
  runtime,
  loading,
  className,
}: {
  runtime?: Runtime;
  loading: boolean;
  className?: string;
}) {
  const mobile = useMediaQuery("(max-width: 767px)");
  const [open, setOpen] = useState(false),
    [pinned, setPinned] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null),
    popoverRef = useRef<HTMLDivElement | null>(null),
    pinnedRef = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearOpen = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const closeSurface = useCallback(() => {
    pinnedRef.current = false;
    setPinned(false);
    clearOpen();
    cancelClose();
    setOpen(false);
  }, [clearOpen, cancelClose]);
  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!pinnedRef.current) setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);
  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const openAfterHover = () => {
    cancelClose();
    clearOpen();
    openTimer.current = setTimeout(openNow, HOVER_OPEN_DELAY_MS);
  };
  useEffect(
    () => () => {
      clearOpen();
      cancelClose();
    },
    [clearOpen, cancelClose],
  );
  useEffect(() => {
    if (!open || mobile) return;
    const outside = (event: PointerEvent) => {
      if (
        !pinnedRef.current ||
        !(event.target instanceof Node) ||
        triggerRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      )
        return;
      closeSurface();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pinnedRef.current) closeSurface();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, mobile, closeSurface]);
  const { style } = useViewportClamp({
    triggerRef,
    popoverRef,
    placement: "vertical-smart",
    open: open && !mobile,
    gutter: 8,
  });
  const label =
    runtime?.displayName ?? (loading ? "读取中…" : "当前配置不可用");
  const status = runtime
    ? runtime.available
      ? "CLI 已检测到"
      : "CLI 未检测到"
    : "CLI 状态未知";
  const { formatShortDateTime } = useTimeFormatter();
  const observed = runtime?.probeValidatedAt ?? runtime?.probeObservedAt;
  const surface = (
    <OfficialRuntimeInfoBody
      label={label}
      runtimeVersion={runtime?.version}
      onClose={closeSurface}
    >
      <DescriptionList direction="horizontal">
        <InfoRow label="本机检测">{status}</InfoRow>
        <InfoRow label="执行文件">
          <span className="break-all font-mono">
            {runtime?.resolvedExecutablePath ?? runtime?.executable ?? "未提供"}
          </span>
        </InfoRow>
        <InfoRow label="可选模型">
          {runtime ? `${runtime.modelBindingDescriptors.length} 个` : "未提供"}
        </InfoRow>
        <InfoRow label="检测时间">
          {observed ? formatShortDateTime(observed) : "未提供"}
        </InfoRow>
        <InfoRow label="账户额度">当前未提供账户额度</InfoRow>
      </DescriptionList>
    </OfficialRuntimeInfoBody>
  );
  return (
    <OfficialRuntimeInfoFrame
      label={label}
      className={className}
      open={open}
      mobile={mobile}
      pinned={pinned}
      triggerRef={triggerRef}
      popoverRef={popoverRef}
      popoverStyle={style}
      status={
        <Status
          size="sm"
          variant={runtime?.available ? "success" : "default"}
          className="ml-1"
          aria-label={status}
        />
      }
      surface={surface}
      handleMouseEnter={() => {
        if (!mobile) openAfterHover();
      }}
      handleMouseLeave={() => {
        if (!mobile) {
          clearOpen();
          closeSoon();
        }
      }}
      handleFocus={() => {
        if (!mobile) openNow();
      }}
      handleBlur={() => {
        if (!mobile) closeSoon();
      }}
      pinOpen={() => {
        pinnedRef.current = true;
        setPinned(true);
        openNow();
      }}
      closeSurface={closeSurface}
      cancelClose={cancelClose}
      closeSoon={closeSoon}
    >
      {label}
    </OfficialRuntimeInfoFrame>
  );
}
