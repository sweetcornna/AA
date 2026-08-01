# AA 隐私说明（发布前草案）

AA 只处理完成认证、分账、实时同步、AI 辅助和语音转写所需的数据。本草案描述已确定的技术路径；数据控制者、联系方式、删除渠道和生效日期仍须在公开发布前由运营方填写并审查。

## 托管与处理区域

- AA backend 计划自托管在 Azure Japan East VM，通过 `https://aa-api.cornna.xyz` 提供 production API。
- staging 与 production 使用不同 Compose stack、数据库 volume、JWT、SMTP、OpenAI credential 和 backup container。
- 数据库和内部服务不直接对公网开放；外部只经 TLS API gateway。
- 第一版备份为每日 age-encrypted PostgreSQL logical backup，并复制到独立 Azure Blob container。未完成 base backup/WAL archive 与 restore 验收前，不声称具备 PITR。

## 账号、账本与邀请

AA 处理邮箱、认证 session、用户资料、圈子成员关系、账单、分摊、结算和邀请 token。数据库使用 Row Level Security 和受控 RPC 限制访问。邀请只使用 24 位 base64url token 的 `aa://join` deep link。

Email/password 注册当前不要求邮箱 confirmation，因此注册后立即返回 session；六位 email OTP 只允许现有用户登录，10 分钟过期、至少 60 秒后重发。验证码由 Resend SMTP 发送。日志和 evidence 不得记录邮箱、OTP、JWT、完整邀请 token 或 URL。

## 语音记账

- 只有用户点按语音并同意云端转写后，App 才请求麦克风权限并录音。
- 每次录音最长 60 秒、原始音频最大 8 MiB。离开页面、切到后台、取消、出错或达到限制时停止麦克风。
- Android 录音只存在运行内存，通过 HTTPS 发给 AA Edge Function，再转交 OpenAI `gpt-4o-transcribe`。
- App、数据库和 Edge Function 不保存原始音频；完成、失败或取消后丢弃内存数据。
- Edge Function 和 gateway 日志不得含 audio、transcript、JWT、邮箱、邀请 token、provider key 或 provider 原始响应。
- transcript 先用于账单预填；用户核对并明确保存后，才可能依账单 audit 字段作为 `raw_text` 保存，同时记录 ASR provider 名称。
- 用户拒绝麦克风权限、不同意云端转写或转写失败时，可继续使用手动输入。

OpenAI 默认对 API 输入/输出保留最多 30 天用于提供服务和识别滥用，之后从其系统删除（法律要求保留的除外）；Zero Data Retention 需单独申请、仅适用于符合条件的端点和用例。本项目当前未确认已获批 ZDR，因此语音数据按默认 30 天保留理解。OpenAI 的账号区域设置和已批准的 Data Processing Agreement 必须在 production gate 中核对，并在公开隐私说明中给出准确链接和版本；不得在未核对实际账户配置时做“零保留”等承诺。

## AI 辅助

AI 可解析账单文字、回答账本问题或提出结算建议。它不能直接写入账本：expense prefill 与 settlement proposal 都需要用户明确确认，最终写入仍受数据库 RLS/RPC 约束。`ai_settings.ai_enabled=false` 可切回不出网的 rule provider。

保存的 AI audit 数据可能包括用户确认后的 `raw_text`、provider 标识、confidence 和结构化结果。不得保存 provider 原始响应 body。

## Secret 与客户端边界

SMTP、OpenAI、service-role、JWT signing 和数据库 secret 只存在服务器 root-only env 或受保护环境，不进入 App、APK、`VITE_*`、客户端日志、GitHub artifact 或 Release。

APK 只允许包含 exact production HTTPS origin、public anon/publishable key 和公开的 Android certificate SHA-256。

## 安全与保留

- API gateway 和 TLS vhost access log 默认关闭；服务日志做 size/rotation 限制。
- ASR 使用每用户 quota、8 MiB/60 秒限制和 timeout。
- encrypted backup 分环境保存，默认本地保留 30 天；Azure Blob 的最终 retention/immutability policy 必须在 production evidence 中记录。
- restore drill 必须在无公网、无 SMTP/provider 的隔离 stack 中执行。
- 安全事件、删除请求和 provider incident 的响应 owner 尚待运营方填写。

## 公开发布前必须填写

以下任一项为空都禁止公开 APK：

- 数据控制者法定名称：`<REQUIRED>`
- 隐私联系邮箱/渠道：`<REQUIRED>`
- 账号与账本数据删除申请方式和响应期限：`<REQUIRED>`
- production Azure subscription/region 与 Azure 数据处理条款确认：`<REQUIRED>`
- Resend 数据处理与保留政策链接/版本：Data Processing Addendum（更新日期 2025-12-31）<https://resend.com/legal/dpa>；隐私政策 <https://resend.com/legal/privacy-policy>；子处理者清单 <https://resend.com/legal/subprocessors>。DPA Exhibit A 载明账户终止后 90 天内删除用户/收件人数据。**发布前须由运营方复核当时的最新版本日期。**
- OpenAI ASR 数据处理与实际账户保留设置链接/版本：平台数据控制说明 <https://developers.openai.com/api/docs/guides/your-data>；企业隐私 <https://openai.com/enterprise-privacy/>。默认 API 输入/输出最多保留 30 天用于服务与滥用检测，之后删除（法律要求除外）；Zero Data Retention 需申请且仅限符合条件的端点与用例。**本项目当前未确认已获批 ZDR，因此按默认 30 天保留描述；不得声称零保留，除非运营方在实际账户设置中核实并在此记录。**
- Azure Blob backup retention 与删除策略：`<REQUIRED>`
- 生效日期与版本化变更记录：`<REQUIRED>`
