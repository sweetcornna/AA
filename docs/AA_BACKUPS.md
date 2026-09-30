# GitHub 每日 AA 备份

已启用：独立私有仓库 `sweetcornna/AA-backups` 的 GitHub Actions 在洛杉矶时间每天 03:17 运行，也支持手动触发。每份备份保留 90 天，备份失败会使该 workflow 失败；可在 GitHub Actions 查看失败通知。

每份备份包含 PostgreSQL 完整逻辑快照，以及 AA 运行配置、不可变函数/模板和实际部署提交的完整源码。数据库与配置在 P1 上用 age 加密，GitHub runner 只下载密文、校验其 SHA-256 和结构，然后存入私有 workflow artifact。账号、账本、JWT、SMTP/模型 key 不以明文离开 P1。解密 identity 不上传 GitHub，必须另存于受限的离线或本地保险库。

服务器为 GitHub 安装单独的 SSH public key，使用 `restrict,command="/usr/local/sbin/aa-github-backup"`。该 key 只接受 `backup` 导出请求，不能执行其他命令、打开 shell、分配 PTY、转发端口或 agent。原有管理 SSH key 保持原样。Runner 使用已经验证的服务器 host key，拒绝未知主机。

实现文件：

- `scripts/github-backup-export.sh`：root-owned 固定导出命令；不会重启服务或删除生产卷。
- `.github/backup-repository/daily-backup.yml`：私有备份仓库的 workflow 模板。
- `.github/backup-repository/scripts/verify-backup.py`：不解密、不提取的密文校验。

AA 主仓库继续管理代码。定时任务的 workflow 必须放在私有备份仓库的默认分支；它不能依赖本机 Codex 在线。GitHub 的 schedule 可能延迟，03:17 是计划时间而非精确 SLA。

恢复时下载所需 artifact，校验外层 checksum 和 manifest，使用保险库中的 age identity 解密数据库/配置，按 `docs/HOSTED_DEPLOYMENT.md` 的隔离 restore-only 流程验证。不要直接覆盖生产数据库，也不要通过 GitHub 暴露解密 key。首次保存备份并不等于完成恢复演练。

## 首次验收（2026-09-30）

用户批准后，私有仓库、默认分支上的定时 workflow、受限 SSH key 和 GitHub Secrets 均已启用。

- [首次 GitHub 运行](https://github.com/sweetcornna/AA-backups/actions/runs/36709831406)：`success`，artifact `aa-production-20260930T113911Z` 已保存，过期时间为 `2026-12-29T11:39:02Z`。
- 下载包为 6,339,349 bytes；外层 SHA-256、manifest、两个 age 密文的校验值及格式全部通过。
- 用本机保存的 identity 完整解密成功；PostgreSQL 17 的 `pg_restore --list` 能读取下载的逻辑快照。此验证没有写入数据库或停止生产服务。
- 配置包包含运行 env、不可变函数/模板、AA Nginx 配置和提交 `b7918024c062d76f556b95cbab65050de3fe9915` 的完整源码；没有包含 age 解密 identity。
- 专用 SSH key 请求任意 `id` 命令时被拒绝，返回 64；服务器原有管理 SSH key 保留。
- 解密 identity 已保存在本机 `~/.ssh/aa_backup_age_20260930.key`（0600，位于仓库外），未上传 GitHub。

已验证首次备份与解密可读性；没有执行向隔离数据库恢复数据的完整 restore drill。定时任务在 GitHub 执行，本机 Codex 或电脑离线不影响计划运行。

官方说明：[定时工作流](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[Artifacts 保留期](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)。
