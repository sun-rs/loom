// GENERATED from locked db5e399 source; explicit Loom slots/guards, not a second business owner.
import type {ReactNode} from "react";import {useIntl} from "react-intl";import {PanelSectionHeader,PanelHeaderContent,PanelTitle,PanelMeta} from "raft-ui";
export function OfficialTasksHeader({meta}:{meta:ReactNode}){const {formatMessage}=useIntl();return (<PanelSectionHeader data-loom-root-header>
          <PanelHeaderContent>
            <PanelTitle render={<h2>{formatMessage({ id: "task.panel.heading" })}</h2>} />
            <PanelMeta render={<p />}>{meta}</PanelMeta>
          </PanelHeaderContent>
        </PanelSectionHeader>);}
