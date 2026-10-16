// The checked Vite adapter exposes this no-prop native section without importing
// unrelated upstream SettingsPanel implementation types into Loom's TS project.
declare module "loom-native-appearance" {
  export const SystemChannelsSection: import("react").ComponentType;
  export const AppearanceSection: import("react").ComponentType;
}
