export function fileReferenceText(absolutePath: string) {
  return `@${JSON.stringify(absolutePath)}`;
}
