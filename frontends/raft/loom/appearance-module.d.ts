// The checked Vite adapter exposes this no-prop native section without importing
// unrelated upstream SettingsPanel implementation types into Loom's TS project.
declare module "loom-native-appearance" {
  export const LoomNotificationStatus: import("react").ComponentType<{
    loading: boolean;
    subscribed: boolean;
    confirmed: boolean;
    busy: boolean;
    testing: boolean;
    message: string;
    handleEnable: () => void;
    handleDisable: () => void;
    handleSendTest: () => void;
    children?: import("react").ReactNode;
    statusLabel: string;
    permission: NotificationPermission | "unsupported";
    serverConfigured: boolean;
    error: string;
    detail: string;
    channel: { kind: string; reason?: string };
  }>;
  export const SystemChannelsSection: import("react").ComponentType;
  export const LoomAccountSection: import("react").ComponentType;
  export const LoomAboutSection: import("react").ComponentType<{
    appVersion: string;
  }>;
}

declare module "loom-native-release-notes" {
  export const LoomReleaseNotes: import("react").ComponentType<{
    releases: readonly unknown[];
  }>;
}
