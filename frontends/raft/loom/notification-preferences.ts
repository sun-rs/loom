/** Coordinates device notification controls; domain qualification remains in Kernel. */
export async function setSystemNotifications(
  enabled: boolean,
  port: {
    requestPermission(): Promise<NotificationPermission>;
    setLocal(value: boolean): void;
    stopBackground(): Promise<unknown>;
  },
) {
  if (enabled) {
    if ((await port.requestPermission()) !== "granted")
      throw Error("请在浏览器设置中允许系统通知。");
    port.setLocal(true);
  } else {
    await port.stopBackground();
    port.setLocal(false);
  }
}
