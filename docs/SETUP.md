# 本地运行与验证指南

## 0. 现状速览（里程碑 1）

已完成并**已验证**（仅需 Node）：
- monorepo 脚手架（npm workspaces）
- `packages/shared` 分账/结算核心逻辑 + **24 个单测全过**
- `apps/app` React 前端 **typecheck 通过 + vite build 通过**
- Tauri v2 原生外壳脚手架 + 5 平台图标已生成

待**首次运行环境**才能验证（需要安装/启动外部依赖）：
- 数据库 migrations：需 `supabase start`（Docker）后 `supabase db reset` 实际应用
- 多人实时同步、登录、记账全链路：需连上 Supabase
- Tauri 原生构建：首次 `npm run tauri dev` 会编译 Rust 外壳（数分钟）
- Playwright E2E：需前端 + Supabase 同时在跑

## 1. 安装依赖

```bash
npm install
```

## 2. 启动本地 Supabase

需要 Docker 在运行。安装 CLI（本机尚未安装）：

```bash
brew install supabase/tap/supabase
cd /Users/cornna/project/AA
supabase init        # 若提示已存在 migrations 会保留它们
supabase start       # 拉起本地 Postgres/Auth/Realtime/Studio（首次拉镜像较慢）
supabase db reset    # 应用 supabase/migrations/* + seed.sql
```

`supabase start` 结束后会打印 **API URL** 与 **anon key**，以及 Inbucket 地址
（`http://localhost:54324`，本地登录验证码/magic link 都进这里）。

## 3. 配置前端环境变量

```bash
cp apps/app/.env.example apps/app/.env
# 把上一步打印的 API URL / anon key 填进去
```

## 4. 跑 Web 版（最快）

```bash
npm run dev --workspace=@aa/app   # http://localhost:1420
```

两人同步验证：用正常窗口 + 隐身窗口分别用不同测试邮箱登录（验证码看 Inbucket）；
A 建圈→生成邀请链接→B 打开链接登录加入→A 记一笔→B 不刷新即更新。

## 5. 跑桌面原生版（Tauri）

Rust 已安装。首次会编译 Rust 依赖（数分钟）：

```bash
npm run tauri --workspace=@aa/app -- dev
```

打包：`npm run tauri --workspace=@aa/app -- build`（产出当前桌面平台安装包；
Linux 包需在 Linux 上构建）。

## 6. 跑移动端（Android / iOS）

```bash
cd apps/app
npm run tauri android init   # 需 Android Studio + SDK/NDK
npm run tauri ios init       # 需 Xcode + CocoaPods
npm run tauri android dev    # 模拟器/真机
npm run tauri ios dev
```

深链接（邀请/OTP 回跳）scheme 为 `aa://`（见 `src-tauri/tauri.conf.json`）；
移动端的 universal/app links 关联域名在各平台工程里再配置。

## 7. 跑单元测试

```bash
npm test                 # 全部 workspace
npm test --workspace=@aa/shared
```

## 8. 语音 / AI 记账（里程碑 2）

"一句话记账"在记一笔页顶部：输入/语音说一句话 → `parse-expense` Edge Function 解析成结构化账单 → 预填表单（含人名对齐、未识别项高亮）→ 确认保存（`source='agent'`，原文存 `raw_text`）。

- 本地起 Edge Function：`supabase functions serve parse-expense`（首次拉 edge-runtime 镜像）。
- **默认无需 API key**：未设 `ANTHROPIC_API_KEY` 时走本地规则兜底解析（金额/人名/分类/相对日期），流程可直接跑通。
- **接入真 Claude**：设密钥后自动改用 Claude（Opus 4.8，strict tool use 强约束结构化输出）：
  ```bash
  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # 或本地：
  echo 'ANTHROPIC_API_KEY=sk-ant-...' >> supabase/functions/.env
  supabase functions serve parse-expense --env-file supabase/functions/.env
  ```
- AI 层厂商无关：`parse-expense` 里 `parseWithClaude`/`fallbackParse` 可替换/扩展为其他 provider。
- 端到端验证：`python3 scripts/e2e-ai-parse.py`（说"我和小红吃火锅 200 平摊"→预填¥200→保存）。

## 关键设计备注

- 金额一律用**整数最小币种单位（分）**，分账用最大余数法保证求和守恒。
- 加入圈子 / 建圈 / 记账走 **SECURITY DEFINER RPC**（`accept_invitation` /
  `create_circle` / `create_expense`），在数据库内校验，省去了单独的 Edge Function
  与 service-role key（比原计划更简单、同样安全）。
- 余额来自 `circle_balances` 视图（`security_invoker`，继承 RLS）。
- AI / 语音是里程碑 2；`expenses.source/raw_text/ai_*` 字段已预留。
