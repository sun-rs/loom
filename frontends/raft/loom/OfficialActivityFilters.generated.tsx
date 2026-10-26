// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import {Inbox,CircleDot,AtSign,Pin} from "lucide-react";
import type {ReactNode} from "react";
import {useIntl} from "react-intl";
import {SegmentedControl,SegmentedControlItem,SegmentedControlLabel} from "raft-ui";
export default function ActivityFilters({value:filter,onChange:setFilter,actions}:{value:string;onChange:(value:string)=>void;actions?:ReactNode}) {const {formatMessage}=useIntl();return (<div
            data-testid="inbox-toolbar"
            className="@container flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-line-seam bg-layer-canvas px-4"
          >

                <SegmentedControl iconsOnlyBelow="auto"
                  value={filter}
                  onValueChange={setFilter}
                  aria-label={formatMessage({ id: "thread.filter.ariaLabel" })}
                >
                  <SegmentedControlItem value="all" data-testid="inbox-filter-all"><Inbox aria-hidden className="hidden in-data-icons-only:block" />
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.all" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="unread" data-testid="inbox-filter-unread"><CircleDot aria-hidden className="hidden in-data-icons-only:block" />
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.unread" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="mentions" data-testid="inbox-filter-mentions"><AtSign aria-hidden className="hidden in-data-icons-only:block" />
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.mentions" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                <SegmentedControlItem value="pinned" data-testid="inbox-filter-pinned"><Pin aria-hidden className="hidden in-data-icons-only:block" /><SegmentedControlLabel>{formatMessage({id:"thread.filter.pinned",defaultMessage:"已置顶"})}</SegmentedControlLabel></SegmentedControlItem></SegmentedControl>
            {actions}
          </div>); }
