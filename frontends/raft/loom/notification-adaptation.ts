/** Keep official trigger/center composition; replace only its cloud collector. */
export function adaptNotificationTrigger(source: string) {
  const from =
    'const liveNotifications = useVisibleNotifications(flavor === "mobile-navbar" ? "mobile" : "desktop");';
  if (source.split(from).length !== 2)
    throw Error("Official notification trigger changed");
  return source.replace(
    from,
    "const liveNotifications: NotificationEntry[] = [];",
  );
}
