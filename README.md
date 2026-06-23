# AA — 记账分账多平台软件

一个 AA 制（going-Dutch / bill-splitting）记账 app：记录花销、把朋友拉进"圈子"共享账本、选择和谁 AA（默认平均，也可精确金额 / 份额）、看"谁欠谁多少"并一键结算；后续支持语音 / AI Agent 记账。

## 平台

一套 **React + TypeScript + Vite** 前端，用 **Tauri v2** 打包成 **Windows / macOS / Linux 桌面 + Android / iOS 移动**原生 app（同一份代码也可部署为 Web）。

## 技术栈

- 前端：React 19 + TypeScript + Vite + Tailwind + shadcn/ui
- 外壳：Tauri v2（桌面 + 移动）
- 后端：Supabase（Postgres + Auth OTP + RLS + Realtime + Storage + Edge Functions）
- 共享逻辑：`packages/shared`（分账 / 结算纯函数，整数分运算，Vitest 单测）

## 仓库结构

```
AA/
├─ supabase/        # 数据库 migrations、Edge Functions、seed
├─ packages/shared/ # 跨端纯逻辑：money / split / balances / settle / zod schema
└─ apps/app/        # Vite React 前端 + Tauri 外壳
```

## 开发

```bash
npm install
npm test                 # 跑 packages/shared 单测
```

完整方案见 `~/.claude/plans/a-a-agent-stateless-dream.md`。
