export function iconName(name: string): string {
  return (
    (
      {
        briefcase: "code-xml",
        chat: "message-square",
        chevron: "chevron-right",
        clip: "paperclip",
        doc: "code-xml",
        folder: "folder-closed",
        gear: "settings",
        home: "house",
        listcheck: "list-todo",

        members: "users",
        pulse: "activity",

        task: "square-check-big",
      } as Record<string, string>
    )[name] ?? name
  );
}
