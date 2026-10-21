// Compatibility only: labelStyle is retired; native FieldLabel owns typography.
import OfficialFormField, {type FormFieldProps as OfficialProps} from "../../../../../loom/OfficialFormField.generated.tsx";
export type FormFieldProps = OfficialProps & {labelStyle?: "uppercase" | "plain"};
export default function FormField({labelStyle: _legacyLabelStyle, ...props}:FormFieldProps){return <OfficialFormField {...props}/>;}
