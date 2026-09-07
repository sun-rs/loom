/** Raft MachineDetailPanel recovery disclosure; local workbench instructions. */
export function ComputerRecoveryGuide() {
  return (
    <details className="rah-profile-disclosure rah-computer-recovery">
      <summary>本机恢复指南</summary>
      <ol>
        <li>
          先刷新页面，区分页面连接失败和 Agent CLI
          运行失败。关闭窗口不会停止后台工作。
        </li>
        <li>使用下方本机诊断命令，按实际检查结果处理问题。</li>
        <li>仅当工作台尚未运行时启动。不要对同一状态目录重复启动。</li>
        <li>
          需要重启时，先等待 Agent
          活跃工作结束，核对进程、状态目录和构建；使用指南中的安全重启流程，保留历史、配置和记忆。
        </li>
      </ol>
      <a
        href="/help/local-workbench.html#recovery"
        target="_blank"
        rel="noreferrer"
      >
        查看完整本机恢复步骤
      </a>
    </details>
  );
}
