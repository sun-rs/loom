import NativeAvatarSlot, {type AvatarSlotProps as NativeProps} from "../../../../../loom/OfficialAvatarSlot.generated";
export type AvatarContext = NativeProps["context"] | "surface-list" | "members-row";
export type AvatarSlotProps = Omit<NativeProps,"context"> & {context:AvatarContext};
export default function AvatarSlot({context,...props}:AvatarSlotProps){
 return <NativeAvatarSlot {...props} context={context==="surface-list"?"list-row":context==="members-row"?"compact-row":context}/>;
}
