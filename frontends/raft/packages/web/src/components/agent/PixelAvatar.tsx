import {AgentAvatar as NativeAgentAvatar} from "../../../../../loom/OfficialPixelAvatar.generated";
import {roleAvatarUrl} from "../../../../../loom/profile-avatar";
export * from "../../../../../loom/OfficialPixelAvatar.generated";
export {default} from "../../../../../loom/OfficialPixelAvatar.generated";
// Legacy callers already provide their frame. Ignore retired leaf sizing props.
export function AgentAvatar({avatarUrl}:{avatarUrl:string|null;size?:number;className?:string}) {
 return <NativeAgentAvatar avatarUrl={roleAvatarUrl(avatarUrl)}/>;
}
