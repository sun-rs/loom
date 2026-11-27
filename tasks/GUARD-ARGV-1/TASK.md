# GUARD-ARGV-1：pre-tool 守卫把命令参数里的 CLI 名误判为裸调用

两次实况（2026-11-27）：pilot-2 T120 执行 `node run-eval.mjs --cli codex ...`、pilot-cell ACCT-4E-R3 执行 `node cli/loom.mjs accounts ... --cli codex,agy,opencode`，都被 worker 的 pre-tool 守卫拒绝："Use a resolved absolute path for native CLIs"。守卫把参数值里的 codex/agy/opencode 当成了要执行的命令，浪费了两次 host 授权。证据：/Users/sun/Code/loom-pilot2/.project/eval-g9/blocked-t120-pre-tool-hook.md（只读）。

## 要做
1. 找到守卫的命令解析逻辑（agy/codex/claude 各自的 pre-tool hook 或 shell 守卫），写 RED：上述两条命令必须放行；`codex exec ...`、`agy -p ...`、`opencode run ...` 这类裸调用仍必须拒绝；管道、`&&`、`;`、子 shell、`env X=Y codex` 等形式里出现在可执行位置的裸名仍拒绝。
2. 修复：只检查每个简单命令的可执行位置（argv[0]，跳过 env 赋值与 `env`/`command`/`exec` 前缀），不检查参数。
3. 全量 `npm test`、`npm run lint` 通过。分支 infra/guard-argv，工作树 /Users/sun/Code/repos/loom-guard-argv，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。不往 pilot 终端输入，不读凭据。
