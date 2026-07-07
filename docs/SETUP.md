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

"一句话记账"在记一笔页顶部：输入/语音说一句话 → `parse-expense` Edge Function 解析成结构化账单 → 预填表单（含人名对齐、未识别项高亮）→ 确认保存（语音来源 `source='voice'`、纯文字 AI 解析 `source='agent'`，原文存 `raw_text`，同时落 `ai_provider/asr_provider/ai_confidence/ai_raw` 审计字段）。

「助手」页问账本（`agent-query`）：花销/结余/谁付的自动回答；说"帮我和小明结一下账"时 agent 只**提议**一笔结算（金额来自服务端权威快照，模型不能编造），界面出确认卡片，点「确认结算」才由客户端在 RLS 约束下写入。

- 本地 `supabase start` 自带 edge runtime，直接服务 `supabase/functions/*`；改代码后 `docker restart supabase_edge_runtime_AA` 生效。
- **默认无需 API key**：未配置密钥时走规则 provider（金额/人名/分类/相对日期/结算建议），流程可直接跑通。
- **AI 层厂商无关、可插拔**（`supabase/functions/_shared/llm/`）：`registry.ts` 按
  「`ai_settings` 圈子行 > `ai_settings` 全局行 > `LLM_PROVIDER` 环境变量 > 默认 claude」
  解析 provider；任一层 `ai_enabled=false` 是总开关（强制规则 provider，不出外网）。
  已内置 `claude`（默认，strict tool use）/ `openai`（chat completions + json_schema）/
  `rule`（零依赖兜底）；**加一家 AI = 一个实现类 + registry 注册一行**。
  ```bash
  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # 或本地：
  echo 'ANTHROPIC_API_KEY=sk-ant-...' >> supabase/functions/.env
  # 切换厂商：LLM_PROVIDER=openai + OPENAI_API_KEY=...，或往 ai_settings 表插一行
  ```
- 端到端验证：`node scripts/verify-ai.mjs`（解析 → 助手问答 → 结算提议/确认 → 总开关，13 项断言）；
  UI 冒烟另有 `python3 scripts/e2e-ai-parse.py`。

## 关键设计备注

- 金额一律用**整数最小币种单位（分）**，分账用最大余数法保证求和守恒。
- 加入圈子 / 建圈 / 记账走 **SECURITY DEFINER RPC**（`accept_invitation` /
  `create_circle` / `create_expense`），在数据库内校验，省去了单独的 Edge Function
  与 service-role key（比原计划更简单、同样安全）。
- 余额来自 `circle_balances` 视图（`security_invoker`，继承 RLS）。
- AI / 语音（里程碑 2）已落地：`expenses.source/raw_text/ai_*` 记录每笔账的 AI 来源与
  置信度；`ai_settings` 表在运行时切换厂商/关停 AI，无需重新部署。
