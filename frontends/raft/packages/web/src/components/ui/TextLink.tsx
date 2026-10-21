import type {ComponentProps} from "react";
import TextLink from "@loom/raft-web-source/TextLink";
export type {TextLinkVariant} from "@loom/raft-web-source/TextLink";
// Historical callers may pass inline; it never changes the native control.
export default function LoomTextLink({inline:_inline,...props}:ComponentProps<typeof TextLink>&{inline?:boolean}) {return <TextLink {...props}/>;}
