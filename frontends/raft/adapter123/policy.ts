/** Single-release semantic seams and named Loom-only slots; no native CSS or size overrides. */
export function adaptNativeCapabilities(code: string, path: string) {
  const preferenceMarkers: [string, string][] = path.endsWith(
    "/components/layout/Sidebar.tsx",
  )
    ? [
        [
          "activityMuted: nextActivityMuted,\n      });",
          "previous.prefsVersion",
        ],
      ]
    : path.endsWith("/components/message/ChatPanel.tsx")
      ? [
          [
            "activityMuted: nextActivityMuted,\n      });",
            "previous.prefsVersion",
          ],
          [
            "collapseLongMessages: nextCollapseLongMessages,\n      });",
            "previous.prefsVersion",
          ],
        ]
      : path.endsWith("/components/settings/SettingsPanel.tsx")
        ? [["serverPushMuted,\n      });", "serverPrefsVersionRef.current"]]
        : [];
  for (const [marker, value] of preferenceMarkers) {
    if (code.split(marker).length !== 2)
      throw Error("Native preference revision seam changed");
    code = code.replace(
      marker,
      marker.replace(
        "\n      });",
        `\n        loomPrefsVersion: ${value},\n      });`,
      ),
    );
  }
  const quota = path.endsWith("/components/agent/CreateAgentDialog.tsx")
    ? "const atLimit = agentCapacityLimitState.reached;"
    : path.endsWith("/components/channel/CreateChannelDialog.tsx")
      ? "const atLimit = maxChannels !== -1 && channels.length >= maxChannels;"
      : undefined;
  if (quota) {
    if (code.split(quota).length !== 2)
      throw Error("Native local-capacity seam changed");
    return code.replace(
      quota,
      "const atLimit = false; // Local Loom has no Raft subscription quota.",
    );
  }
  if (!path.endsWith("/components/agent/AgentDetailPanel.tsx")) return code;
  const promptSlot = "          {/* Skills */}";
  const descriptionSlot =
    "      {showOperationalInfo && isExternalAgent && canManageAgent && (";
  const activeMarker =
    'const isActive = displayState.isOnline || agent.status === "active";';
  if (
    code.split(promptSlot).length !== 2 ||
    code.split(activeMarker).length !== 2 ||
    code.split(descriptionSlot).length !== 2
  )
    throw Error("Native Role prompt/config seam changed");
  code =
    'import {RoleInstructions as LoomRoleInstructions} from "loom:role-profile";\nimport LoomRoleInstances from "loom:role-instances";\nimport {InstanceStartStop as LoomInstanceStartStop} from "loom:role-lifecycle";\n' +
    code
      .replace(
        promptSlot,
        "          <LoomRoleInstances agent={agent as any} />\n" + promptSlot,
      )
      .replace(
        descriptionSlot,
        "          <LoomRoleInstructions agent={agent as any} />\n" +
          descriptionSlot,
      )
      .replace(
        activeMarker,
        'const isActive = !(agent as any).loomRoleId && (displayState.isOnline || agent.status === "active");',
      )
      .replace(
        "<AgentStartStopButton agentId={agent.id} onShowStopConfirm={openStopConfirm} />",
        "<LoomInstanceStartStop agentId={agent.id} onShowStopConfirm={openStopConfirm} />",
      );
  const marker = "() => AGENT_TABS.filter((tab) => {";
  if (code.split(marker).length !== 2)
    throw Error("Native Role tab capability seam changed");
  return code.replace(
    marker,
    marker +
      '\n      // Loom has no Raft-managed MCP, integrations, reminders or global Agent session.\n      if (tab !== "profile" && tab !== "activity") return false;',
  );
}
