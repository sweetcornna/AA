# 网页版部署手册（GitHub Pages）

网页版和五个原生端共用同一份 `apps/app` 代码。`vite build` 产出的 `apps/app/dist/`
就是完整站点：纯静态、无服务端渲染、无 service worker。

站点地址：<https://sweetcornna.github.io/AA/>（已上线）

## 构建契约

| 项 | 取值 | 来源 |
| --- | --- | --- |
| `base` | `./`（相对路径） | `vite.config.ts`：未设 `TAURI_ENV_PLATFORM` 即判定为网页构建 |
| 路由 | `HashRouter` | 静态托管无需 404 回退，子路径也不会 404 |
| 后端 | `https://aa-api.cornna.xyz` | 生产构建 fail-closed，见 `supabaseConfiguration.ts` |
| 站点地址 | `VITE_WEB_ORIGIN` | workflow 中取自 `actions/configure-pages` 的 `base_url` |

相对 `base` 意味着同一份产物在 `/AA/`、根路径或自定义域名下都能直接用，
换域名不必重新构建。

## 一次性前置动作

1. ~~**启用 Pages**~~ —— 已完成（`build_type=workflow`，自动创建的
   `github-pages` 环境只允许 `main` 部署）。

2. ~~**放行浏览器跨域**~~ —— 已完成（2026-08-03）。Kong 的 CORS 白名单原先只有
   Tauri 的三个源，浏览器发来的 `https://sweetcornna.github.io` 被丢弃，页面表现
   为「网络连接失败，请稍后重试」。现已放行，实测：

   ```
   $ curl -i -X OPTIONS 'https://aa-api.cornna.xyz/auth/v1/token?grant_type=password' \
       -H 'Origin: https://sweetcornna.github.io' -H 'Access-Control-Request-Method: POST'
   access-control-allow-origin: https://sweetcornna.github.io
   ```

   Tauri 三个源仍在白名单内（已发布的 Android 包不受影响），未列出的源仍无
   allow-origin 头。

   Realtime 走 WebSocket，不受 CORS 预检约束；Edge Functions 自身返回
   `Access-Control-Allow-Origin: *`（`supabase/functions/_shared/cors.ts`），
   但它们同样经 Kong，所以仍以 Kong 白名单为准。

### 改 Kong 配置的实际路径

Kong 容器把**服务器上的仓库检出**直接挂进去，不读 `AA_TEMPLATE_DIR` 的运行时副本：

```
/srv/aa/src/infra/supabase-selfhost/templates/kong/kong.yml → /home/kong/temp.yml (ro)
```

`kong-entrypoint.sh` 在启动时对它做环境变量替换后生成 `KONG_DECLARATIVE_CONFIG`，
启动时**不校验 fingerprint**。所以改 Kong 配置 = 把 `/srv/aa/src` 移到目标 commit
再 `docker restart aa-production-primary-kong-1`（约 16 秒恢复 healthy）：

```bash
sudo bash -c 'cd /srv/aa/src && git fetch -q origin main && git checkout -q $(git rev-parse origin/main)'
sudo docker restart aa-production-primary-kong-1
sudo bash -c 'cd /srv/aa/src && bash infra/supabase-selfhost/scripts/health-check.sh /srv/aa/production/stack.env'
```

回滚就是 checkout 回原 commit 再重启。**不要**为此重跑 `generate-env.py`：它会重铸
JWT 凭据，让已发布的客户端全部失效。

> ⚠️ **已知漂移**：本次只移动了源码检出并重启 Kong，没有重跑部署管线，所以
> `/srv/aa/production/stack.env` 的 `AA_SOURCE_FINGERPRINT` 仍是旧 commit
> `90aa0f1` 的 `b964c217…`，而源码现在是 `9d4b963`（指纹 `340c609c…`）。
> 运行时无影响（Kong 不读它；`AA_TEMPLATE_DIR` / `AA_FUNCTIONS_DIR` 指向的旧目录
> 内容与新 commit 一致，本次没改 templates 与 functions），但
> `run-migrations.py` 会因指纹不匹配 fail-closed。下次正式部署重跑管线即自动对齐。

## 发布

Actions → **Web** → Run workflow（只有手动触发，与本仓库其余发布路径一致）。

流程：`npm ci` → 单测 → `configure-pages` → 构建 → 断言产物指向生产 origin、且注入的
publishable key 不是 secret 形态 → 上传 artifact → 部署。构建 job 绑定 `production`
环境，读取 `PRODUCTION_SUPABASE_URL` / `PRODUCTION_SUPABASE_PUBLISHABLE_KEY` 两个变量。

> 该断言检查的是**注入的取值**而不是产物文本。别改回整包 grep
> `sb_secret_|service_role`：`supabaseConfiguration.ts` 里拒绝这类 key 的守卫代码
> 本身就含这两个字面量，minify 后仍在包里，grep 必然命中自己。

## 本地验证

Pages 是子路径部署，根路径下跑通不等于子路径下跑通。按实际路径验证：

```bash
VITE_SUPABASE_URL=https://aa-api.cornna.xyz \
VITE_SUPABASE_PUBLISHABLE_KEY=<公开 publishable key> \
VITE_WEB_ORIGIN=https://sweetcornna.github.io/AA \
  npm run build --workspace=@aa/app

mkdir -p /tmp/site && cp -R apps/app/dist /tmp/site/AA
cd /tmp/site && python3 -m http.server 8899
# 打开 http://127.0.0.1:8899/AA/
```

## 网页版与原生端的差异

- **邀请链接**：配了 `VITE_WEB_ORIGIN` 的构建生成
  `https://sweetcornna.github.io/AA/#/join?token=…`，任意浏览器可开、任意相机可扫；
  没配的构建仍生成 `aa://join?token=…`（只有装了 App 的设备能打开）。
  `release.yml` 目前**没有**注入 `VITE_WEB_ORIGIN`，所以已发布的 Android 包
  仍生成 `aa://` 链接；要改需单独走发布流程。
- **深链**：`aa://` 由原生壳的 deep-link 插件处理；网页版靠 HashRouter 直接进
  `/join`。仓库未配置 Android App Links / iOS Universal Links，https 邀请链接
  不会被原生 App 接管，网页 `/join` 页会给出「在 App 中打开」的入口。
- **语音**：网页版走 Web Speech（浏览器支持时）或录音上传 `asr-transcribe`，
  与桌面端一致；Android 原生壳固定走录音上传。
- **宽屏排版**：`data-platform="web"` 下 ≥768px 会把 448px 主列框出来，
  原生壳不受影响。
- **没有 service worker**：不可离线，不做后台更新。

## 已验收（2026-08-03，线上站点，Chromium 桌面视口）

注册 → 自动登录 → 建圈子 → 记一笔 ¥128.50 → 圈子详情正确显示「1 位成员 · 共
¥128.50 账单」「已结清」→ 生成邀请链接得到
`https://sweetcornna.github.io/AA/#/join?token=…` 且二维码编码同一链接。
`health-check.sh` 在 Kong 重启后报告 production stack healthy。

留下一个验收账号 `web-acceptance-20260803@cornna.xyz`（昵称「Web 验收账号」）
及其「网页版验收」圈子和那笔账，未清理。

## 未覆盖

- 未做 PWA 离线壳与安装引导（`manifest.webmanifest` 已就位，但无 SW）。
- 未接自定义域名；换域名只需在 Pages 设置里配好，`VITE_WEB_ORIGIN` 会自动跟随。
- 只在 Chromium 桌面视口验收；未覆盖 Safari / 移动浏览器 / 真机。
- 未验收邮箱验证码登录与 AI 功能——它们受托管栈的 SMTP / OpenAI 凭据限制，
  与网页版本身无关（见 `docs/HOSTED_DEPLOYMENT.md`）。
- 未验收两个账号之间的邀请加入与实时同步。
