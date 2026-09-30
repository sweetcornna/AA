# GitHub 每日 AA 备份

部署候选：独立私有仓库 `sweetcornna/AA-backups` 的 GitHub Actions 在洛杉矶时间每天 03:17 运行，也支持手动触发。每份备份保留 90 天，备份失败会使该 workflow 失败；可在 GitHub Actions 查看失败通知。

每份备份包含 PostgreSQL 完整逻辑快照，以及 AA 运行配置、不可变函数/模板和实际部署提交的完整源码。数据库与配置在 P1 上用 age 加密，GitHub runner 只下载密文、校验其 SHA-256 和结构，然后存入私有 workflow artifact。账号、账本、JWT、SMTP/模型 key 不以明文离开 P1。解密 identity 不上传 GitHub，必须另存于受限的离线或本地保险库。

服务器为 GitHub 安装单独的 SSH public key，使用 `restrict,command="/usr/local/sbin/aa-github-backup"`。该 key 只接受 `backup` 导出请求，不能执行其他命令、打开 shell、分配 PTY、转发端口或 agent。原有管理 SSH key 保持原样。Runner 使用已经验证的服务器 host key，拒绝未知主机。

候选文件：

- `scripts/github-backup-export.sh`：root-owned 固定导出命令；不会重启服务或删除生产卷。
- `.github/backup-repository/daily-backup.yml`：私有备份仓库的 workflow 模板。
- `.github/backup-repository/scripts/verify-backup.py`：不解密、不提取的密文校验。

AA 主仓库继续管理代码。定时任务的 workflow 必须放在私有备份仓库的默认分支；它不能依赖本机 Codex 在线。GitHub 的 schedule 可能延迟，03:17 是计划时间而非精确 SLA。

恢复时下载所需 artifact，校验外层 checksum 和 manifest，使用保险库中的 age identity 解密数据库/配置，按 `docs/HOSTED_DEPLOYMENT.md` 的隔离 restore-only 流程验证。不要直接覆盖生产数据库，也不要通过 GitHub 暴露解密 key。首次保存备份并不等于完成恢复演练。

本文件记录部署候选。私有仓库、受限 SSH key、GitHub Secrets 和首次实际备份均待用户批准后启用。

官方说明：[定时工作流](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[Artifacts 保留期](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)。
