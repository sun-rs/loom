import type { RoomAgentAvatarKey } from "@rah/runtime-protocol";

type AvatarPreset = { background: string; grid: readonly string[] };

const PALETTE: Readonly<Record<string, string>> = Object.freeze({
  K: "#141111", W: "#FFFFFF", P: "#FE7DA8", O: "#F8A16F",
  Y: "#FFD440", L: "#A9D877", C: "#27CCF3", V: "#BBAFE6",
  B: "#576574", R: "#F97264", G: "#9DCAAA", D: "#B07A4E",
});

/**
 * Byte-transcribed from Raft's shipped preset table in index-WTraJnrd.js
 * (sha256 fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725).
 * This table is an extracted upstream asset, not screenshot inference and not
 * a procedural pixel generator.
 */
export const OFFICIAL_AGENT_AVATARS: Readonly<Record<RoomAgentAvatarKey, AvatarPreset>> = {
  robot: { background: "#27CCF3", grid: ["_KKKKKK_", "KCKWWKCK", "KWKWWKWK", "KKKKKKKK", "_KWKKWK_", "_KKKKKK_", "_KK__KK_", "_KK__KK_"] },
  cat: { background: "#FFD440", grid: ["K______K", "KK____KK", "KYKYYKYK", "KYYYYYYK", "KYKYYKYK", "_KYYYYK_", "__KYYK__", "___KK___"] },
  ghost: { background: "#BBAFE6", grid: ["__KKKK__", "_KWWWWK_", "KWKWWKWK", "KWWWWWWK", "KWWWWWWK", "KWWKKWWK", "KWKWWKWK", "K_K__K_K"] },
  skull: { background: "#F8A16F", grid: ["_KKKKKK_", "KWWWWWWK", "KWKWWKWK", "KWWWWWWK", "_KWWWWK_", "_KWKWKK_", "__KKKK__", "___KK___"] },
  alien: { background: "#A9D877", grid: ["_KKKKKK_", "KGGGGGGK", "KGKKKKGK", "KGGGGGGK", "_KGGGGK_", "__KGGK__", "__KGGK__", "_KK__KK_"] },
  heart: { background: "#FE7DA8", grid: ["________", "_KK__KK_", "KRRKKRRK", "KRRRRRRK", "KRRRRRRK", "_KRRRRK_", "__KRRK__", "___KK___"] },
  star: { background: "#FFD440", grid: ["___KK___", "___KK___", "KKKKKKKK", "_KYYYYK_", "__KYYK__", "_KYKKYK_", "KYK__KYK", "KK____KK"] },
  flame: { background: "#F8A16F", grid: ["___K____", "__KRK___", "__KRKK__", "_KORRRK_", "_KOORRK_", "KYOOORK_", "KYYOOK__", "_KKKK___"] },
  diamond: { background: "#27CCF3", grid: ["___KK___", "__KCCK__", "_KCWCCK_", "KCWCCCCK", "KCCCCCCK", "_KCCCCK_", "__KCCK__", "___KK___"] },
  mushroom: { background: "#FE7DA8", grid: ["__KKKK__", "_KRWWRK_", "KRRWWRRK", "KRRRRRRK", "_KKKKKK_", "__KWWK__", "__KWWK__", "_KKKKKK_"] },
  eye: { background: "#BBAFE6", grid: ["________", "__KKKK__", "_KWWWWK_", "KWWKKWWK", "KWWKKWWK", "_KWWWWK_", "__KKKK__", "________"] },
  crown: { background: "#FFD440", grid: ["________", "_K_KK_K_", "_KKKKKK_", "_KYYYYK_", "_KYYYYK_", "KKKKKKKK", "KYYYYYYK", "KKKKKKKK"] },
  cloud: { background: "#27CCF3", grid: ["________", "__KK____", "_KWWKK__", "KWWWWWK_", "KWWWWWWK", "KWWWWWWK", "_KKKKKK_", "________"] },
  sun: { background: "#F97264", grid: ["_K_KK_K_", "K_KYYK_K", "_KYYYYK_", "KYYYYYYK", "KYYYYYYK", "_KYYYYK_", "K_KYYK_K", "_K_KK_K_"] },
  bell: { background: "#576574", grid: ["___KK___", "__KYYK__", "_KYYYYK_", "_KYYYYK_", "_KYYYYK_", "KYYYYYYK", "KKKKKKKK", "___KK___"] },
  tree: { background: "#A9D877", grid: ["___KK___", "__KGGK__", "_KGGGGK_", "KGGGGGGK", "KGGGGGGK", "_KKGGKK_", "__KOOK__", "___KK___"] },
};

export function AgentAvatar(props: {
  avatarKey?: RoomAgentAvatarKey;
  size?: number;
  label: string;
  className?: string;
}) {
  const preset = OFFICIAL_AGENT_AVATARS[props.avatarKey ?? "robot"];
  const size = props.size ?? 32;
  return (
    <svg
      className={props.className}
      width={size}
      height={size}
      viewBox="0 0 8 8"
      role="img"
      aria-label={props.label}
      shapeRendering="crispEdges"
      data-avatar-source="raft-extracted-official-preset"
    >
      <rect width="8" height="8" fill={preset.background} />
      {preset.grid.flatMap((row, y) => [...row].map((cell, x) =>
        cell === "_" ? null : (
          <rect key={`${x}:${y}`} x={x} y={y} width="1" height="1" fill={PALETTE[cell]} />
        ),
      ))}
    </svg>
  );
}
