// GENERATED from preserved Raft db5e399 RuntimeAccountUsageChip presentation.
// Loom supplies runtime facts/status/content; quota is not invented. Native badge/card/sheet geometry retained.
import type {ReactNode,RefObject,CSSProperties,ComponentProps} from 'react';
import {createPortal} from 'react-dom';
import {useIntl} from 'react-intl';
import {Badge,Card} from 'raft-ui';
import {X} from 'lucide-react';
import CloseButton from '../packages/web/src/components/ui/CloseButton.tsx';
import BottomSheet from '../packages/web/src/components/ui/BottomSheet';
import {dismissLayerProps,notDismissLayerProps} from '../packages/web/src/components/ui/dismissLayer';
const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_DELAY_MS = 160;
function runtimeBadgeClassName(className: string): string {
  return `${className} inline-flex items-center`;
}
export {HOVER_OPEN_DELAY_MS,HOVER_CLOSE_DELAY_MS};
export function OfficialRuntimeInfoBody({label,runtimeVersion,onClose,children}:{label:string;runtimeVersion?:string;onClose:()=>void;children:ReactNode}){const {formatMessage}=useIntl();return <div><div className="flex items-center justify-between gap-3 border-b border-line-hairline px-4 py-3">
        <div className="min-w-0">
          <div className="text-headline text-foreground">{label}</div>
          <div data-testid="runtime-info-version" className="font-mono text-mono-meta text-foreground-hint">
            {runtimeVersion?.trim()
              ? formatMessage({ id: "machine.runtimeUsage.version" }, { version: runtimeVersion.trim() })
              : formatMessage({ id: "machine.runtimeUsage.versionUnavailable" })}
          </div>
        </div>
        <CloseButton type="button" className="" onClick={onClose} data-loom-control="detail-close" aria-label="关闭运行时信息">
          <X size={16} />
        </CloseButton>
      </div>
<div className="px-4 py-5">{children}</div></div>;}
export function OfficialRuntimeInfoFrame({label,children,status,surface,open,mobile,pinned,triggerRef,popoverRef,popoverStyle,handleMouseEnter,handleMouseLeave,handleFocus,handleBlur,pinOpen,closeSurface,cancelClose,closeSoon,className='',appearance='soft',variant='information'}:{label:string;children:ReactNode;status:ReactNode;surface:ReactNode;open:boolean;mobile:boolean;pinned:boolean;triggerRef:RefObject<HTMLButtonElement|null>;popoverRef:RefObject<HTMLDivElement|null>;popoverStyle:CSSProperties;handleMouseEnter:()=>void;handleMouseLeave:()=>void;handleFocus:()=>void;handleBlur:()=>void;pinOpen:()=>void;closeSurface:()=>void;cancelClose:()=>void;closeSoon:()=>void;className?:string;appearance?:ComponentProps<typeof Badge>['appearance'];variant?:ComponentProps<typeof Badge>['variant']}){return (
    <>
      <Badge
        data-testid="role-runtime-info-trigger" ref={triggerRef}
        render={<button type="button" />}
        appearance={appearance}
        variant={variant}
        className={`${runtimeBadgeClassName(className)} relative cursor-help outline-none focus-visible:shadow-focus`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={pinOpen}
      >
        {children}
        {status}
      </Badge>
      {open && mobile && (
        <BottomSheet role="dialog" aria-label={label+" 运行时信息"} onClose={closeSurface} sheetClassName="max-h-[82vh] overflow-y-auto">
          {surface}
        </BottomSheet>
      )}
      {open && !mobile && createPortal(
        <Card
          ref={popoverRef}
          {...(pinned ? dismissLayerProps : notDismissLayerProps)}
          role="dialog"
          aria-label={label+" 运行时信息"}
          // A floating surface (Raft DS Popover): popover layer, seam edge,
          // float shadow — the card recipe alone is an in-flow card.
          className="z-[70] w-[min(390px,calc(100vw-16px))] overflow-y-auto border-line-seam bg-layer-popover shadow-float"
          style={popoverStyle}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
        >
          {surface}
        </Card>,
        document.body,
      )}
    </>
  );}
