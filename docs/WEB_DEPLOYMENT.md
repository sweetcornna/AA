# 网页版部署手册（GitHub Pages）

网页版和五个原生端共用同一份 `apps/app` 代码。`vite build` 产出的 `apps/app/dist/`
就是完整站点：纯静态、无服务端渲染、无 service worker。

站点地址（Pages 启用后）：`https://sweetcornna.github.io/AA/`

## 构建契约

| 项 | 取值 | 来源 |
| --- | --- | --- |
| `base` | `./`（相对路径） | `vite.config.ts`：未设 `TAURI_ENV_PLATFORM` 即判定为网页构建 |
| 路由 | `HashRouter` | 静态托管无需 404 回退，子路径也不会 404 |
| 后端 | `https://aa-api.cornna.xyz` | 生产构建 fail-closed，见 `supabaseConfiguration.ts` |
| 站点地址 | `VITE_WEB_ORIGIN` | workflow 中取自 `actions/configure-pages` 的 `base_url` |

相对 `base` 意味着同一份产物在 `/AA/`、根路径或自定义域名下都能直接用，
换域名不必重新构建。

## 一次性前置动作（需要 operator 操作，仓库脚本不会代劳）

这两项都还没做，**不做完网页版无法登录**：

1. **启用 Pages**：仓库 Settings → Pages → Source 选 **GitHub Actions**。
   （当前 `GET /repos/sweetcornna/AA/pages` 返回 404，即未启用；未启用时
   workflow 的 `configure-pages` 步骤会直接失败。）

2. **放行浏览器跨域**：自托管 Kong 的 CORS 白名单原先只有 Tauri 的三个源，
   浏览器发来的 `https://sweetcornna.github.io` 不在其中。实测预检：

   ```
   $ curl -i -X OPTIONS 'https://aa-api.cornna.xyz/auth/v1/token?grant_type=password' \
       -H 'Origin: https://sweetcornna.github.io' \
       -H 'Access-Control-Request-Method: POST'
   HTTP/2 200          # 无 access-control-allow-origin ⇒ 浏览器丢弃响应
   ```

   `infra/supabase-selfhost/templates/kong/kong.yml` 的 `origins` 已补上该源，
   但**运行中的栈仍是旧配置**：需要按 `docs/HOSTED_DEPLOYMENT.md` 的既有流程把
   模板重新渲染到 `AA_TEMPLATE_DIR` 并 reload Kong（模板变更会改变
   `AA_SOURCE_FINGERPRINT`，按该手册的 stop gates 走）。

   改完后同一条 `curl` 应回显 `access-control-allow-origin: https://sweetcornna.github.io`。

   Realtime 走 WebSocket，不受 CORS 预检约束；Edge Functions 自身返回
   `Access-Control-Allow-Origin: *`（`supabase/functions/_shared/cors.ts`），
   但它们同样经 Kong，所以仍以 Kong 白名单为准。

## 发布

Actions → **Web** → Run workflow（只有手动触发，与本仓库其余发布路径一致）。

流程：`npm ci` → 单测 → `configure-pages` → 构建 → 断言产物指向生产 origin 且不含
secret 形态的 key → 上传 artifact → 部署。构建 job 绑定 `production` 环境，读取
`PRODUCTION_SUPABASE_URL` / `PRODUCTION_SUPABASE_PUBLISHABLE_KEY` 两个变量。

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

## 未覆盖

- 未做 PWA 离线壳与安装引导（`manifest.webmanifest` 已就位，但无 SW）。
- 未接自定义域名；换域名只需在 Pages 设置里配好，`VITE_WEB_ORIGIN` 会自动跟随。
- 未做网页端的真机/多浏览器验收。
