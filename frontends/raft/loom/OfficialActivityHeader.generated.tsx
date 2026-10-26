// GENERATED from locked db5e399 source; explicit Loom slots/guards, not a second business owner.
import {CheckCheck} from "lucide-react";import type {ReactNode,ComponentProps} from "react";import {useIntl} from "react-intl";import {Button} from "raft-ui";import PanelHeader from "../packages/web/src/components/ui/PanelHeader";import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";import Tooltip from "@loom/raft-web-source/Tooltip";
export function OfficialActivityHeader({totalCount,totalUnreadCount,unknownSubtitle,onMobileBack,mobileBackProps,headerContainerProps,headerTitleClickProps,actions}:{totalCount:number|undefined;totalUnreadCount:number|undefined;unknownSubtitle?:string;onMobileBack:(()=>void)|undefined;mobileBackProps:ComponentProps<typeof PanelHeader>["mobileBackProps"];headerContainerProps:ComponentProps<typeof PanelHeader>["containerProps"];headerTitleClickProps:ComponentProps<typeof PanelHeader>["titleClickProps"];actions:ReactNode}){const {formatMessage}=useIntl();return (<PanelHeader
        actions={actions}
        title={formatMessage({ id: "thread.header.title" })}
        subtitle={typeof totalCount === "number" && typeof totalUnreadCount === "number" ? formatMessage({ id: "thread.header.subtitle" }, { activeCount: totalCount, unreadCount: totalUnreadCount }) : unknownSubtitle}
        onMobileBack={onMobileBack}
        mobileBackProps={mobileBackProps}
        containerProps={headerContainerProps}
        titleClickProps={headerTitleClickProps}
      />);}
export function OfficialActivityMarkAll({busy,handleMarkAllRead}:{busy:boolean;handleMarkAllRead:()=>void}){const {formatMessage}=useIntl();return (<Tooltip content={formatMessage({ id: "thread.markAllRead.title" })}>
                  <Button
                    disabled={busy}
                    onClick={handleMarkAllRead}
                    size="md"
                    variant="ghost"
                    className="-mr-[calc(--spacing(3)+1.5px)] shrink-0 whitespace-nowrap @max-[30rem]:-mr-2 @max-[30rem]:size-8 @max-[30rem]:px-0"
                    data-testid="inbox-mark-all-read"
                  >
                    <CheckCheck aria-hidden className="hidden @max-[30rem]:block" /><span className="@max-[30rem]:sr-only">{formatMessage({ id: "thread.markAllRead.label" })}</span>
                  </Button>
                </Tooltip>);}
