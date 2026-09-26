export declare const KIMI_UNSAFE_PERMISSION_MODE: "KIMI_UNSAFE_PERMISSION_MODE";
export declare const KIMI_NATIVE_GOAL_ACTIVE: "KIMI_NATIVE_GOAL_ACTIVE";
export declare const KIMI_SAFE_MODE_ID: "default";

export type KimiNativeGoal = { goalId: string; status: string };
export type KimiNativeState = {
  goal: KimiNativeGoal | null;
  permissionMode: string;
};
export type KimiSessionInspection =
  | ({ state: "read" } & KimiNativeState)
  | { state: "unavailable"; reason: string };

export declare function isKimiGoalMutationTool(title: unknown): boolean;
export declare function isKimiUserQuestionTool(title: unknown): boolean;
export declare function kimiHome(environment?: NodeJS.ProcessEnv): string;
export declare function foldKimiMainWire(text: string): KimiNativeState;
export declare function inspectKimiSession(
  sessionId: string,
  environment?: NodeJS.ProcessEnv,
): KimiSessionInspection;
export declare function assertKimiResumeSafe(
  inspection: KimiSessionInspection,
): void;
export declare function assertKimiSafeMode(effective: string | undefined): void;
