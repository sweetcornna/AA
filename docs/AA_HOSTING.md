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

## 2026-09-30 恢复候选

只读诊断确认网页可打开、七个容器运行、数据库有 7 个账号/4 个圈子/10 笔账，14 项迁移已应用。故障来自 Kong 的 80 MiB 上限：两个自动 worker 持续被 OOM kill，累计超过 17,000 次，但容器健康命令仍能通过；实际 API 请求出现超时/502。

候选修复为单 worker、8 MiB cache、缩小 proxy buffers 和 192 MiB 上限，容量门同步提高至 1008 MiB。健康脚本新增 OOM 检查，并保留 legacy/publishable key 的实际 Auth/REST 探测。上线后须验证实际公网请求、内存余量和 OOM 增量。候选已准备，生产部署尚待用户批准；本记录不代表恢复成功。
