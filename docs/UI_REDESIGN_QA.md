# 原生风格改版与圈子退出验收

日期：2026-09-05。截图、邮箱与账单均来自独立测试账号；所有写入回归在本地 Supabase 运行，未修改生产数据或发布线上版本。

## 已实现

- `0014_circle_departure.sql` 提供受控退出和历史参与者查询。当前成员净结余为零才可退出；圈主指定现有接任人，转让和退出原子完成；最后一人退出后撤销邀请，历史账目完整保留。所有相关 RPC 按圈子优先的顺序锁定，避免记账、结算、加入与退出互相穿透。
- 删除聊天助手页面、`agent-query`、问答/结算提议代码及其构建、部署、测试依赖；旧地址跳回首页。保留一句话记账、规则回退、语音转写和历史 AI 审计字段。
- 统一 SVG、卡片、表单、导航、弹窗与状态反馈。手机使用底部导航，1024px 起采用侧栏和双列详情；不同币种分别汇总；取消伪柱状图。支持键盘焦点、弹窗焦点返回及减少动态效果。
- 修复回归中发现的成员缓存漏分摊、全部取消分摊后被重新选中、日元金额显示、跨账号缓存、自动加入导航回调、旧深链反复打开、WebKit 录音 MIME，以及 Android 授权弹窗误取消录音等问题。录音与转写均可主动取消。

## 验收结果

| 检查 | 结果与覆盖 |
| --- | --- |
| 单元与属性测试 | 137 项通过：整数金额、三种分摊、结算、余额、邀请、鉴权导航、语音状态及新增币种汇总/兼容回归 |
| 后端原有回归 | 74 项检查通过，包含权限、注册、邀请并发、费用完整性、动态与 ASR 配额及测试数据清理 |
| 新增退出集成测试 | 46 项通过，包含正负结余阻止、接任人、重复退出、历史身份、重新加入、权限撤销，以及退出对记账/结算/加入/邀请创建的并发情况 |
| 部署契约与基础设施 | 22 项部署测试、基础设施检查及仓库策略检查通过 |
| Edge Functions | Deno 类型检查及 11 项测试通过；两个独立输出目录构建的函数产物一致，函数清单只保留 `asr-transcribe` 和 `parse-expense` |
| Web 完整业务 | Chromium、Firefox、WebKit 各 8 个端到端场景，统一运行 24/24 通过（2.6 分钟） |
| Web 布局 | 三种引擎均检查 360、390、768、1280、1440px，无横向页面溢出；覆盖弹窗焦点、Escape 和减少动态效果 |
| Android 原生业务 | `aa_test` / Android 14、arm64 模拟器上 16 项流程通过：登录、建圈、二维码邀请、三种分账、智能预填、实时同步、未结清拦截、圈主转让、深链重新加入、系统返回、动态、资料保存、旧助手地址及退出登录 |
| Android 麦克风 | 使用真实系统权限对话框和 WebView MediaRecorder；拒绝、授权、二进制音频上传、后台取消、60 秒自动停止和错误/超时恢复通过 |
| Web 构建 | 生产构建通过，并实测构建产物的登录/注册懒加载路由无运行时错误；最大 JS 分块约 212.59 KB（gzip 54.94 KB），原主分块约 648.03 KB |
| Android 构建 | Tauri Android 调试构建成功并实际安装运行；未生成或发布新的正式签名发行版 |

浏览器语音测试使用合成音源和浏览器真实 MediaRecorder，转写上游使用受控响应；Android 权限和录音测试使用实际模拟器媒体接口，未替换上游响应。

**尚未验收：**本地 ASR 实际返回 `asr_not_configured`，因此真实云端转写准确性/服务连通性仍待配置后验证；没有执行物理 Android 真机或其他原生平台的运行验收。不能将这些项目视为已通过。

## 截图与记录

- [桌面圈子页](screenshots/redesign-circles-desktop.png)
- [桌面圈子详情](screenshots/redesign-detail-desktop.png)
- [手机圈子详情](screenshots/redesign-detail-mobile.png)
- [Android 原生详情](screenshots/redesign-android.png)
- 本地逐项记录和完整截图：`.artifacts/ui-qa/`；测试追踪可能包含临时测试令牌，保持忽略，不写入版本库。
- 本次运行摘要：`.artifacts/ui-qa/summary.json`；终端记录：`.artifacts/ui-qa/logs/`。
- Playwright 最终报告：`apps/app/playwright-report/index.html`。
- 本地 Android 调试 APK：`apps/app/src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`。此包依赖本地开发服务，不能作为公开发行包。

## 复现

需要 Node 22+、Deno 2.9.1、Docker、Supabase CLI；Android 还需要既有 SDK/NDK/JDK 17 与模拟器。Colima 用户可为相关命令设置其实际 `DOCKER_HOST`。

```bash
npm ci
supabase start
supabase migration up --local
supabase functions serve
```

另一个终端启动开发服务器，配置本地 Supabase 的公开开发凭证：

```bash
npm run dev --workspace=@aa/app -- --host 127.0.0.1
npx playwright install chromium firefox webkit
npm test
npm run typecheck
npm run test:backend
node scripts/verify-ai.mjs
npm run test:e2e
npm run test:deployment
npm run test:infrastructure
npm run test:repository-policy
```

Web 编译采用 CI 的合成公开配置，仅校验产物，不能将该 key 当作真实服务凭证：

```bash
VITE_SUPABASE_URL=https://aa-api.cornna.xyz \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_build_validation \
npm run build
```

Android 在启动 `aa_test` 后运行本地调试构建，保留开发服务：

```bash
source scripts/android-env.sh
adb reverse tcp:1420 tcp:1420
adb reverse tcp:54321 tcp:54321
npm run tauri --workspace=@aa/app -- android dev --no-watch \
  --config '{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1420"}}'
```

另一个终端分别执行（两者共享一个设备，必须串行）：

```bash
node scripts/android-ui-smoke.mjs
node scripts/android-voice-smoke.mjs
```

脚本通过语义定位操作 WebView；原生授权按钮按系统资源 ID 获取当次边界，未使用固定屏幕坐标。

## 上线顺序

1. 按现有部署手册备份，在目标库追加 `0014`；不要修改已发布迁移或重置业务库。
2. 构建并验证仅包含两个业务函数的新产物，更新函数路由，移除旧 `agent-query` 服务。
3. 使用真实环境公开配置构建前端，再沿用 Web/Android 现有发布流程。正式 Android 版本、签名和发布门禁保持原配置；发布前需按实际候选包补齐真实服务及所需设备验收。

本次已验证本地迁移和运行，没有执行生产迁移或线上发布。
