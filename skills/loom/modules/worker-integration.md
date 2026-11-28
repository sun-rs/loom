# 集成验收

180. 查卡指定的前置证据。工作树未固定时用 `git checkout --detach "$CANDIDATE"`，核对 HEAD。用 PATH 上的 ps 或 `$LOOM_TEST_PS` 只查本卡 PID，随后以私有 TMPDIR 运行卡面全量命令。
181. 制品记录 SHA、命令、退出码和计数。全量日志留在卡片工作树或私有临时目录，项目汇总交给 Leader。
