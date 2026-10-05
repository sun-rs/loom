// Provider inputs and evaluator answers are deliberately separate exports.
// This is a transport-cost workload, not autonomous discussion acceptance.
import { multiWorkload } from "./multi-channel-workload.mjs";

const instructions =
  "这是三实例各12轮的固定次序只读事实核验，用于观察长任务传输成本，不要求讨论或共识。三人收到同题并可见实际同伴答案，只测共享事实的规范交付，不代表三份独立审查或多人收益。每个实例保持同一原生session，不更换会话。唯一可读文件为当前工作区evidence.txt；每个实例仅在自己的第一轮通过一次只读调用读取完整正文，唯一读取命令为cat evidence.txt，不分段、不添加其他命令；若工具支持max_output_tokens则设为10000或以上以容纳全文，不能靠截断输出猜答案。之后不再读取文件或调用业务工具。回复交付仅按运行环境指定的方式，不授权额外业务操作。只根据固定材料和已经交付的对话回答当前Human问题，同伴结论不是权威。不得读取其他文件或服务状态，不得运行/导入脚本、测试、写文件、操作服务、使用记忆或Task，不得@他人。每轮仅一次最终回答，正文只返回一行：审查结论：题目指定字段=题目指定格式的值。无需解释、引用或行号，不加代码块、空格、句号或额外字段；字段和值按题面大小写。若证据不足，值写unknown；不得猜测或重读。JSON传输外壳不属于正文。没有最低字数要求。";

const questions = [
  "读取fileInventory的返回对象逻辑：当没有任何匹配的运行期凭据目录时，omittedRuntimeCredentials这个自有字段是存在还是省略？字段credential_field，值只能为present或absent。",
  "对确为目录且路径匹配runtimeCredentialDirectory的条目，显式调用fileInventory(root, false)，函数接受还是抛断言拒绝？字段credentials，值只能为accept或reject。",
  "仅考虑socket：fileInventory会记录其路径；backupState遍历是否复制socket到目标？字段socket，值只能为copy或omit。",
  "遍历state时发现符号链接，fileInventory是跟随链接还是拒绝？字段symlink，值只能为follow或reject。",
  "备份遍历发现room.db-wal、room.db-shm、room.db-journal这三种侧车条目，均按哪种方式处理？字段sidecars，值只能为copy或omit。",
  "普通文件源权限为0755时，backupState对目标chmod后的权限是什么？忽略任何调用失败，按可见位运算计算。字段mode，值为四位八进制字符串（首位0）。",
  "backupState处理扩展名为.db的文件时调用的是SQLite backup API还是普通copyFile？字段db，值只能为backup或copyFile。",
  "在首次fileInventory完成之后、末尾复查之前，一个已纳入files的普通文件内容变化并保持，复查获得的哈希与基线不同：backupState接受还是拒绝？字段changed_files，值只能为accept或reject。",
  "verifyDatabase检查PRAGMA quick_check时，预期唯一结果行的值是什么？字段quick_check，值为该字符串原文，不带引号。",
  "verifyDatabase的foreign_key_check返回至少一条记录时，该检查接受还是拒绝？字段foreign_keys，值只能为accept或reject。",
  "重启recheck中，其他内容不变、一个合法匹配的运行期凭据目录稳定存在且两次都被inventory记录。真实左侧返回对象与右侧期望对象的深比较接受还是拒绝？字段stable，值只能为accept或reject。",
  "guardedStop中validate、inspect、backup均成功返回true，verify返回false且没有调用者重试；本次stop步骤会被调用多少次？字段stop_calls，值为十进制非负整数。",
];

export const multiChannelLongWorkload = {
  id: "credential-facts-3x12/v1",
  sourceRef: multiWorkload.sourceRef,
  sourceSlices: multiWorkload.sourceSlices,
  files: multiWorkload.files,
  fileHashes: multiWorkload.fileHashes,
  instructions,
  steps: questions.flatMap((question, index) =>
    ["a", "b", "c"].map((speaker) => ({
      speaker,
      round: index + 1,
      body: `第${index + 1}轮。${index === 0 ? "只读一次evidence.txt全文。" : "不再读取文件或调用业务工具。"}${question}只返回规定的一行。`,
    })),
  ),
  promptSetHash:
    "3a52f20b52f065b9002cb69f60911a85ac4c73e36b470100d7162273b4af59c3",
  identityHash:
    "0c9f8c64412fa44ec658c15a0dd0db1bcc19e13749add9dfd028499c4f49cd29",
};

// Evaluator-only. Never serialize this export into Role instructions, AGENTS,
// evidence.txt, Human questions, peer messages, or provider prompts.
export const multiChannelLongExpected = [
  {
    round: 1,
    field: "credential_field",
    value: "absent",
    source: "state-backup.ts:113–117",
  },
  {
    round: 2,
    field: "credentials",
    value: "reject",
    source: "state-backup.ts:95–101",
  },
  {
    round: 3,
    field: "socket",
    value: "omit",
    source: "state-backup.ts:104,175–176",
  },
  {
    round: 4,
    field: "symlink",
    value: "reject",
    source: "state-backup.ts:93–94",
  },
  {
    round: 5,
    field: "sidecars",
    value: "omit",
    source: "state-backup.ts:175–176",
  },
  { round: 6, field: "mode", value: "0700", source: "state-backup.ts:190–193" },
  { round: 7, field: "db", value: "backup", source: "state-backup.ts:177–188" },
  {
    round: 8,
    field: "changed_files",
    value: "reject",
    source: "state-backup.ts:157,197–202",
  },
  {
    round: 9,
    field: "quick_check",
    value: "ok",
    source: "state-backup.ts:208–218",
  },
  {
    round: 10,
    field: "foreign_keys",
    value: "reject",
    source: "state-backup.ts:220",
  },
  {
    round: 11,
    field: "stable",
    value: "reject",
    source: "state-backup.ts:114–117; restart-local-workbench.mjs:152–156",
  },
  {
    round: 12,
    field: "stop_calls",
    value: "0",
    source: "workbench-restart-guard.mjs:19–28",
  },
].map((entry) => ({
  ...entry,
  answer: `审查结论：${entry.field}=${entry.value}`,
}));
