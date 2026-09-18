export function fileReferenceText(absolutePath: string) {
  return `@${JSON.stringify(absolutePath)}`;
}
export function composerPrimaryAction(input: {
  body: string;
  attachmentCount: number;
  working: boolean;
  stopping: boolean;
}) {
  if (input.body.trim() || input.attachmentCount) return "send";
  return input.stopping ? "stopping" : input.working ? "stop" : "send";
}
