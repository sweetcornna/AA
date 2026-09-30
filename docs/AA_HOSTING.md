# AA 的 GitHub 与自有服务器分工

AA 可以采用 GitHub Pages 托管网页、GitHub 仓库管理代码、自有服务器运行后端的组合；现有生产部署已经采用这条路线。服务器上的 Supabase 是自托管 Docker 服务，不需要购买 Supabase Cloud 项目。

| 部分 | 运行位置 | 作用 |
| --- | --- | --- |
| 网页 | GitHub Pages | 发送浏览器可运行的静态文件 |
| 源码、构建与安装包 | GitHub 仓库 / Actions / Releases | 版本管理、有限时长的构建和发布 |
| 登录、账本接口与权限 | 自有服务器 | Auth、PostgREST、数据库事务与 RLS |
| 多人同步与 AI 接口 | 自有服务器 | Realtime、Edge Functions |
| 账本数据 | 服务器 PostgreSQL | 存储账号、圈子、账单、分摊与结算 |

GitHub Pages 不运行后端进程。GitHub Actions 是构建任务执行环境，不能替代持续在线的 AA 后端。把账本写进仓库文件，需要重做登录、成员权限、并发写入、事务与查询；浏览器也不能携带具有仓库写权限的 token。现有 AA 直接依赖 Supabase 的 RPC、RLS 和 Realtime，无法只替换一个 URL 就改成 GitHub 仓库数据库。

推荐保留现有组合。邮箱验证码仍依赖 SMTP 供应商，AI/语音转写仍依赖模型供应商；密码登录和手动记账的主要服务都在自有服务器上。数据库备份应加密保存，并另存到服务器以外的受控位置。

官方依据：

- [GitHub Pages 的静态托管与服务端语言限制](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [Supabase Docker 自托管](https://supabase.com/docs/guides/self-hosting/docker)

## 2026-09-30 恢复记录

只读诊断确认网页可打开、七个容器运行、数据库有 7 个账号/4 个圈子/10 笔账，14 项迁移已应用。故障来自 Kong 的 80 MiB 上限：两个自动 worker 持续被 OOM kill，累计超过 17,000 次，但容器健康命令仍能通过；实际 API 请求出现超时/502。

用户批准后，生产服务器已部署提交 `b7918024c062d76f556b95cbab65050de3fe9915`：单 worker、8 MiB cache、缩小 proxy buffers 和 192 MiB 上限，容量门同步提高至 1008 MiB。健康脚本新增 OOM 检查，并保留 legacy/publishable key 的实际 Auth/REST 探测。只重建了 Kong；数据库凭据、JWT、网关 keys 和供应商配置保持不变。

上线验证：

- 公网 Auth 健康探测 10/10 成功，GitHub Pages 的 CORS 头正确。
- 七个服务健康，最终 Kong 约 78 MiB / 192 MiB，cgroup `max`、`oom`、`oom_kill` 均为 0；主机可用内存约 578 MiB。
- 两个专用账号完成注册、密码登录、匿名写入拒绝、非成员权限隔离、邀请加入、记账、成员读取、结算及零余额验证。
- 首轮实时消息验收在 tenant 冷启动时超时；临时数据已精确清理。随后完整业务验收通过，Realtime 消息约 625 ms 到达；没有为此修改生产 Realtime 配置。
- 解析函数通过，当前 provider 为 `rule`。未验证真实生产邮箱 OTP、云端模型解析或音频转写。
- 验收临时圈子已清理，圈子/账单仍为 4/10，保留两个专用验收账号用于后续检查（总账号数 9）。
- 新加密备份 `aa-production-20260930T110558Z.dump.age` 已生成，并复制到本机校验 SHA-256；本次没有做独立恢复演练。

部署源指纹为 `8619aac72f77dd65f858ebbf6a85caf770ea456a6843ffadde35874a92117b3a`。回滚材料在服务器 `/srv/aa/recovery-20260930/`：原源码 SHA、原 `stack.env` 与修复 Git bundle，均在 root-only 目录；原 immutable artifacts 仍在。回滚到旧网关预算会重新引入 OOM 风险，应仅作为配置损坏时的应急路径。

修复源码及本记录已在本地分支保存，未推送 GitHub；线上网页没有重新发布。当前结果证明主要记账功能可用，仍需观察长期内存负载与 idle 后 Realtime 冷启动行为。
