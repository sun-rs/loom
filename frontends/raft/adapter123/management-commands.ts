import type { NativeCommands } from "./commands.ts";
/** Native HTTP compatibility only; all mutations use the existing SDK owner. */
export async function managementCommand(
  c: NativeCommands,
  method: string,
  path: string,
  input: any,
) {
  const { bridge } = c,
    { client } = bridge,
    { workspace, server } = await bridge.identity();
  const sos = path.match(
    /^\/channels\/([^/]+)\/(stop-all-agents|resume-all-agents)$/,
  );
  if (method === "post" && sos) {
    const stop = sos[2] === "stop-all-agents";
    const guidance =
      typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!stop && (!guidance || input.agentIds?.length))
      throw Error("请提供完整频道的恢复指导，不支持逐 Agent 重发。");
    const result = await c.mutate(
      stop ? "sos-stop" : "sos-resume",
      sos[1]!,
      stop
        ? { roomId: sos[1]!, resumeOnMessage: false }
        : { roomId: sos[1]!, guidance },
      (p, basedOnRoomSeq, idempotencyKey) =>
        stop
          ? client.request("room.sos.stop", {
              ...p,
              basedOnRoomSeq,
              idempotencyKey,
            } as any)
          : client.request("room.sos.resume", {
              ...p,
              basedOnRoomSeq,
              idempotencyKey,
            } as any),
    );
    let operation = result.operation;
    if (stop && result.operation.state !== "stopped") {
      operation = await c.observe(async () => {
        const current = await client.request("room.execution.read", {
          roomId: sos[1]!,
        });
        if (
          current.operation?.operationId !== result.operation.operationId ||
          current.operation.state !== "stopped" ||
          current.operation.pendingTargetCount !== 0
        )
          throw Error("尚未取得全部 Runtime 的停止证明");
        return current.operation;
      }, "停止请求已保存，尚未确认全部执行结束。请核实状态；不会重新发送停止请求。");
    }
    return {
      data: stop ? { operation } : { results: [], operation },
    };
  }
  const member = path.match(
    /^\/channels\/([^/]+)\/members(?:\/(batch)|\/agent\/([^/]+))?$/,
  );
  if (
    member &&
    ((method === "post" && !member[3]) || (method === "delete" && member[3]))
  ) {
    if (method === "delete") {
      const catalog = await bridge.catalog(),
        instance = catalog.instances.find(
          (i: any) => i.instanceId === member[3] && i.channelId === member[1],
        );
      if (!instance) throw Error("此实例不是该频道成员");
      await c.mutate(
        "instance-remove",
        instance.channelId,
        { roomId: instance.channelId, principalId: instance.instanceId },
        (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("room.member.remove", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      );
      return { data: {} };
    }
    if (input.userId || input.userIds?.length)
      throw Error("Loom 不新增其他 Human 成员");
    const roleIds = member[2] ? input.agentIds : [input.agentId];
    if (!Array.isArray(roleIds) || !roleIds.length) throw Error("请选择角色");
    const catalog = await bridge.catalog();
    if (
      roleIds.some(
        (id: string) => !catalog.roles.some((r: any) => r.roleId === id),
      )
    )
      throw Error("只能从有效 Role 创建新实例");
    for (const roleId of roleIds)
      await c.mutate(
        "instantiate",
        member[1]!,
        { roleId, channelId: member[1]! },
        (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("role.instantiate", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      );
    return {
      data: {
        added: { agentIds: roleIds, userIds: [] },
        alreadyMembers: { agentIds: [], userIds: [] },
      },
    };
  }
  const pref = path.match(
    /^\/channels\/([^/]+)\/(notification-settings|message-display-settings)$/,
  );
  if (
    method === "patch" &&
    (pref || path === `/servers/${server.id}/notification-settings`)
  ) {
    if (
      pref &&
      !(await bridge.rooms()).some((r) => r.roomId === pref[1] && !r.side)
    )
      throw Error("未知频道或不支持此偏好");
    const display = pref?.[2] === "message-display-settings",
      value = pref
        ? display
          ? input.collapseLongMessages
          : input.activityMuted
        : input.serverPushMuted;
    if (typeof value !== "boolean") throw Error("偏好必须是明确的布尔值");
    const p = await c.preferences(input.loomPrefsVersion, (current) => {
      if (!pref) return { mutedWorkspace: value };
      const field = display ? "expandedLongMessages" : "mutedActivity",
        key = "room:" + pref[1],
        active = display ? !value : value;
      return {
        [field]: active
          ? [...new Set([...current[field], key])]
          : current[field].filter((k) => k !== key),
      };
    });
    return {
      data: {
        loomPreferences: p,
        ...(pref
          ? display
            ? { collapseLongMessages: value, prefsVersion: p.version }
            : {
                activityMuted: value,
                activityMuteSupported: true,
                muteFromSeq: null,
                prefsVersion: p.version,
              }
          : { serverPushMuted: value, prefsVersion: p.version }),
      },
    };
  }
  const roomMatch = path.match(
    /^\/channels\/([^/]+)(?:\/(archive|unarchive))?$/,
  );
  if (
    roomMatch &&
    ((method === "patch" && !roomMatch[2]) ||
      (method === "delete" && !roomMatch[2]) ||
      (method === "post" && roomMatch[2]))
  ) {
    const room = (await bridge.rooms()).find((r) => r.roomId === roomMatch[1]);
    if (!room) throw Error("未知频道");
    if (method === "patch") {
      const allowed = ["name", "description"];
      if (Object.keys(input).some((k) => !allowed.includes(k)))
        throw Error("频道仅支持修改名称和描述；不修改可见性或工作区");
      const result = await c.mutate(
        "channel-update",
        room.roomId,
        {
          roomId: room.roomId,
          name: input.name ?? room.name,
          description: input.description ?? room.description ?? "",
          visibility: room.visibility ?? "private",
        },
        (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("room.update", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      );
      return { data: bridge.channelDto(result.room) };
    }
    if (method === "delete") {
      const result = await c.mutate(
        "channel-delete",
        room.roomId,
        { roomId: room.roomId },
        (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("room.delete", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      );
      return { data: result };
    }
    const archived = roomMatch[2] === "archive";
    const result = await c.mutate(
      archived ? "channel-archive" : "channel-unarchive",
      room.roomId,
      { roomId: room.roomId },
      (p, basedOnRoomSeq, idempotencyKey) =>
        client.request(archived ? "room.archive" : "room.unarchive", {
          ...p,
          basedOnRoomSeq,
          idempotencyKey,
        }),
    );
    return { data: bridge.channelDto(result.room) };
  }
  const agent = path.match(
    /^\/agents\/([^/]+)(?:\/(start|stop|reset|restore))?$/,
  );
  if (
    agent &&
    ((method === "delete" && !agent[2]) || (method === "post" && agent[2]))
  ) {
    const catalog = await bridge.catalog(),
      id = agent[1]!,
      action = agent[2],
      role = [...catalog.roles, ...(catalog.deletedRoles ?? [])].find(
        (r: any) => r.roleId === id,
      ),
      instance = catalog.instances.find((i: any) => i.instanceId === id);
    if (!role && !instance) throw Error("未知 Role 或实例");
    if (method === "delete") {
      if (input.workspace && input.workspace !== "keep")
        throw Error("删除配置或移除实例不能删除共享工作区");
      if (role)
        await c.mutate(
          "role-delete",
          workspace.controlRoomId,
          { roleId: id, expectedRoleRevisionId: role.roleRevisionId },
          (p, basedOnRoomSeq, idempotencyKey) =>
            client.request("role.delete", {
              ...p,
              basedOnRoomSeq,
              idempotencyKey,
            }),
        );
      else
        await c.mutate(
          "instance-remove",
          instance.channelId,
          { roomId: instance.channelId, principalId: id },
          (p, basedOnRoomSeq, idempotencyKey) =>
            client.request("room.member.remove", {
              ...p,
              basedOnRoomSeq,
              idempotencyKey,
            }),
        );
      return { data: {} };
    }
    if (action === "restore") {
      if (!role || !catalog.deletedRoles?.some((r: any) => r.roleId === id))
        throw Error("只能恢复已删除的 Role 配置");
      await c.mutate(
        "role-restore",
        workspace.controlRoomId,
        {
          roleId: id,
          expectedRoleRevisionId: role.roleRevisionId,
          displayName: input.displayName ?? role.configuration.displayName,
        },
        (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("role.restore", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      );
      return { data: await bridge.agent(id) };
    }
    const targets = role
      ? catalog.instances.filter(
          (i: any) =>
            i.roleId === id &&
            catalog.agents.some(
              (a: any) =>
                a.definition.agentId === i.agentId &&
                a.definition.state !== "tombstoned",
            ),
        )
      : [instance];
    if (!targets.length) throw Error("此角色尚无实例，请先加入频道");
    if (action === "reset" && !["restart", "session"].includes(input.mode))
      throw Error("不支持删除共享工作区的完整重置");
    // Freeze this explicit batch's member set. Unknown results suspend the same
    // promise/key; a known refusal aborts the remaining members, never reruns them.
    for (const target of [...targets]) {
      if (action === "reset") {
        if (input.mode === "session")
          await c.mutate(
            "session-reset",
            target.channelId,
            {
              instanceId: target.instanceId,
              ...(input.adoptRoleRevisionId
                ? { adoptRoleRevisionId: input.adoptRoleRevisionId }
                : {}),
            },
            (p, basedOnRoomSeq, idempotencyKey) =>
              client.request("instance.session.reset", {
                ...p,
                basedOnRoomSeq,
                idempotencyKey,
              }),
          );
        else
          for (const state of ["disabled", "enabled"] as const)
            await c.mutate(
              "instance-state",
              workspace.controlRoomId,
              { agentId: target.agentId, action: "set_state" as const, state },
              (p, basedOnRoomSeq, idempotencyKey) =>
                client.request("agent.manage", {
                  ...p,
                  basedOnRoomSeq,
                  idempotencyKey,
                }),
            );
      } else
        await c.mutate(
          "instance-state",
          workspace.controlRoomId,
          {
            agentId: target.agentId,
            action: "set_state" as const,
            state:
              action === "start" ? ("enabled" as const) : ("disabled" as const),
          },
          (p, basedOnRoomSeq, idempotencyKey) =>
            client.request("agent.manage", {
              ...p,
              basedOnRoomSeq,
              idempotencyKey,
            }),
        );
    }
    return { data: {} };
  }
}
