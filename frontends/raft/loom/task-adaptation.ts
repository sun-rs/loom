/** Export existing presentation only; keep frozen upstream code unchanged. */
export function exposeTaskPresentation(source: string) {
  for (const name of ["TaskSection", "DroppableColumn"])
    if (source.split(`function ${name}(`).length !== 2)
      throw Error("Official task presentation boundary changed");
  return source + "\nexport { TaskSection, DroppableColumn };\n";
}
