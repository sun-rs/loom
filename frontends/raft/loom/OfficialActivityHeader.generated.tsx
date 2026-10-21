// GENERATED from locked db5e399 source; explicit Loom slots/guards, not a second business owner.
import type {ReactNode,ComponentProps} from "react";import {useIntl} from "react-intl";import {Button} from "raft-ui";import PanelHeader from "../packages/web/src/components/ui/PanelHeader";import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";import Tooltip from "@loom/raft-web-source/Tooltip";
export function OfficialActivityHeader({totalCount,totalUnreadCount,onMobileBack,headerContainerProps,headerTitleClickProps,actions}:{totalCount:number|string;totalUnreadCount:number|string;onMobileBack:()=>void;headerContainerProps:ComponentProps<typeof PanelHeader>["containerProps"];headerTitleClickProps:ComponentProps<typeof PanelHeader>["titleClickProps"];actions:ReactNode}){const {formatMessage}=useIntl();return (<PanelHeader
        actions={actions}
        title={formatMessage({ id: "thread.header.title" })}
        subtitle={formatMessage({ id: "thread.header.subtitle" }, { activeCount: totalCount, unreadCount: totalUnreadCount })}
        onMobileBack={onMobileBack}
        containerProps={headerContainerProps}
        titleClickProps={headerTitleClickProps}
      />);}
export function OfficialActivityMarkAll({busy,handleMarkAllRead}:{busy:boolean;handleMarkAllRead:()=>void}){const {formatMessage}=useIntl();return (<Tooltip content={formatMessage({ id: "thread.markAllRead.title" })}>
                  <Button
                    disabled={busy}
                    onClick={handleMarkAllRead}
                    size="sm"
                    variant="ghost"
                    className="shrink-0 whitespace-nowrap"
                    data-testid="inbox-mark-all-read"
                  >
                    {formatMessage({ id: "thread.markAllRead.label" })}
                  </Button>
                </Tooltip>);}
