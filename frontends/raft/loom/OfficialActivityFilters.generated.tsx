// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import type {ReactNode} from "react";
import {useIntl} from "react-intl";
import {SegmentedControl,SegmentedControlItem,SegmentedControlLabel} from "raft-ui";
export default function ActivityFilters({value:filter,onChange:setFilter,actions}:{value:string;onChange:(value:string)=>void;actions?:ReactNode}) {const {formatMessage}=useIntl();return (<div
            data-testid="inbox-toolbar"
            className="flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-line-seam bg-layer-canvas px-4"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <SegmentedControl
                  value={filter}
                  onValueChange={setFilter}
                  aria-label={formatMessage({ id: "thread.filter.ariaLabel" })}
                >
                  <SegmentedControlItem value="all" data-testid="inbox-filter-all">
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.all" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="unread" data-testid="inbox-filter-unread">
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.unread" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="mentions" data-testid="inbox-filter-mentions">
                    <SegmentedControlLabel>{formatMessage({ id: "thread.filter.mentions" })}</SegmentedControlLabel>
                  </SegmentedControlItem>
                </SegmentedControl>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
            </div>
          </div>); }
