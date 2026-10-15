/** Directly expose the original section; no copied layout or second preferences owner. */
export function exposeAppearance(source: string) {
  if (source.split("function AppearanceSection()").length !== 2)
    throw Error("Official appearance section boundary changed");
  return source + "\nexport { AppearanceSection };\n";
}
export function adaptMessageModelLabel(source: string) {
  const boundary =
    "const agentModelLabelText = showAgentModelNameOption\n    ? catalogModelLabelText ?? agentModelLabel(senderAgent)";
  if (source.split(boundary).length !== 2)
    throw Error("Official message model label boundary changed");
  return (
    'import { useLoomModelLabel } from "loom-appearance";\n' +
    source.replace(
      boundary,
      "const loomModelLabel = useLoomModelLabel(message.senderId);\n  const agentModelLabelText = showAgentModelNameOption\n    ? loomModelLabel ?? catalogModelLabelText ?? agentModelLabel(senderAgent)",
    )
  );
}
