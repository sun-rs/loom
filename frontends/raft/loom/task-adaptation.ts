/** Export existing presentation only; keep frozen upstream code unchanged. */
export function exposeTaskPresentation(source: string) {
  for (const name of ["TaskSection", "DroppableColumn"])
    if (source.split(`function ${name}(`).length !== 2)
      throw Error("Official task presentation boundary changed");
  return source + "\nexport { TaskSection, DroppableColumn };\n";
}
/** Upstream membership defaults must not enable an unconnected status writer. */
export function adaptTaskCard(source: string) {
  const boundary =
    "const canEditStatus = canEditTaskStatus(task, currentUser?.id, canManageServer, role);";
  if (source.split(boundary).length !== 2)
    throw Error("Official task card boundary changed");
  return source.replace(boundary, "const canEditStatus = false;");
}
