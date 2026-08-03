# Android 正式发布流程

AA Android 永久使用 `com.aa.expense`，只发布 release 签名的 `arm64-v8a` APK。当前版本为 `0.0.5`、`versionCode=5`。公开的 v0.0.2 使用 debug 证书，因此从它升级到首个正式版（v0.0.3）需要先卸载；v0.0.3 起共用同一 release certificate，v0.0.4 → v0.0.5 可直接覆盖安装。不得更换 application ID 或永久 release certificate。

## 发布边界

APK 只允许包含：

- `https://aa-api.cornna.xyz`；
- production public anon/publishable key；
- release certificate SHA-256。

APK、Git、workflow artifact、日志、截图和 evidence 禁止包含数据库/JWT/service-role、`sb_secret_*`、SMTP/OpenAI、Cloudflare/Azure credential、keystore 或密码。

Android 发布必须满足：

1. Azure production backend 已按 [HOSTED_DEPLOYMENT.md](HOSTED_DEPLOYMENT.md) 部署并通过 canary；
2. production source fingerprint 与候选 tag 的 fingerprint 完全相同；
3. encrypted backup 新鲜，isolated restore drill 已通过；
4. 永久 keystore 有至少两份加密备份并做过恢复验证；
5. 候选只构建一次；
6. publish 审批者接受并公开记录未做真机验收的残余风险；
7. publish job 下载同一 candidate run artifact，不重新构建、不覆盖已有 asset。

## 永久签名密钥

GitHub `production` environment 保存：

Secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

Variables（均为公开配置）：

- `PRODUCTION_SUPABASE_URL`，必须精确为 `https://aa-api.cornna.xyz`
- `PRODUCTION_SUPABASE_PUBLISHABLE_KEY`
- `PRODUCTION_DEPLOYMENT_FINGERPRINT`
- `ANDROID_CERT_SHA256`

`production-publish` 保存公开变量 `ANDROID_CERT_SHA256`、`PRODUCTION_SUPABASE_URL` 和 `PRODUCTION_SUPABASE_PUBLISHABLE_KEY`，并承担公开发布审批；不得获得 keystore 或 backend/provider secret。publish 会重新探测 exact public key，并与 candidate metadata 中的 key SHA-256 比较。两个 environment 都启用 required reviewers。

本地 release build 从 ignored 文件读取：

`apps/app/src-tauri/gen/android/keystore.properties`

```properties
storeFile=/absolute/path/to/aa-release.jks
storePassword=<secret>
keyAlias=<alias>
keyPassword=<secret>
```

缺失任一配置时 release build fail closed。禁止把 keystore 或密码放入仓库。

## 本地静态候选 gate

只有 backend gates 通过后才设置 public runtime 值：

```bash
export VITE_SUPABASE_URL=https://aa-api.cornna.xyz
export VITE_SUPABASE_PUBLISHABLE_KEY=<PRODUCTION-SB-PUBLISHABLE-KEY>
scripts/android-build-apk.sh release
```

```bash
export AA_ANDROID_CERT_SHA256=<64-HEX-CERT-FINGERPRINT>
export AA_ANDROID_EXPECTED_VERSION_CODE=4
export AA_ANDROID_PRODUCTION_ORIGIN=https://aa-api.cornna.xyz
export AA_ANDROID_PRODUCTION_PUBLIC_KEY=<PRODUCTION-SB-PUBLISHABLE-KEY>
export AA_ANDROID_STAGING_ORIGIN=https://aa-staging-api.cornna.xyz
scripts/android-verify-apk.sh \
  apps/app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

输出：

- `dist/android/AA.Ledger_<version>_android-arm64-v8a.apk`
- 同名 `.sha256`

static verifier 检查：

- application ID、version/versionCode、min 24、target 36；
- release certificate 且不是 Android Debug；
- non-debuggable、cleartext disabled；
- 仅 arm64 native library；
- 仅 INTERNET、RECORD_AUDIO、MODIFY_AUDIO_SETTINGS 与 Android 自动 receiver permission；
- 唯一 `aa://` VIEW/BROWSABLE filter；
- Tauri native library 与本次 runtime bundle 一致；
- exact production origin 和 exact `sb_publishable_*` key 存在，staging/loopback/private HTTP/secret marker 不存在；
- 无 source map/native debug section。

## GitHub Actions：候选

从 GitHub Actions 选择已存在且 immutable 的 `v0.0.5` tag ref，手动运行 `.github/workflows/release.yml`：

- `operation=candidate`
- `tag=v0.0.5`（input 与 workflow run ref 必须指向同一 tag commit）
- `backend_fingerprint=<accepted production bundle SHA-256>`
- publish-only 输入全部留空。

workflow 会：

1. resolve exact tag commit，检查 `version=0.0.5`、`versionCode=5` 和 clean source，并拒绝 tag commit 的 `docs/PRIVACY.md` 仍含 `<REQUIRED>`；
2. 重新计算 repository fingerprint，并与 input 及 protected `PRODUCTION_DEPLOYMENT_FINGERPRINT` 比较；
3. 在 `production` environment 审批后临时恢复 keystore；
4. 构建一次 signed arm64 APK；
5. 运行静态 verifier；
6. 删除 runner signing material；
7. 上传一个扁平 candidate artifact，只含 APK、`.sha256`、`candidate-metadata.json`，保留 14 天。

metadata schema 3 只记录公开身份：repository、run ID、tag、commit、version、versionCode、backend fingerprint、publishable key SHA-256（不记录 key 本身）、application ID、ABI、APK filename/SHA-256、certificate SHA-256。publish 前会重新验证当前 protected key 的 gateway 合同，并要求其 SHA-256 与候选 metadata 一致；key 发生轮换后必须重建候选。

候选 run 不创建 GitHub Release，不构建桌面包。

## 真机 QA 豁免与残余风险

本次发布经 `production-publish` 审批可不把真机验收作为硬门。审批者仍必须从 candidate artifact 转录并复核 candidate run ID 与 exact APK SHA-256，并接受 Release notes 对以下未验证行为的明确披露：安装、登录、升级、机型兼容、麦克风权限/录音和移动网络。

若发布前自愿执行 QA，推荐至少一台真实 arm64 Android 手机覆盖：

- fresh install；确认 v0.0.2 需卸载一次；
- password signup/session、logout/login、6 位 existing-user OTP；
- `aa://join?token=<24-character-base64url>` cold/warm；
- 建圈、加入、expense、RLS、Realtime、balance、debtor settlement；
- microphone allow/deny/permanent deny、cancel/background/60 秒；
- Wi-Fi、蜂窝、离线、provider timeout/quota；
- 一次真实 `gpt-4o-transcribe`；
- ASR → AI prefill 后必须人工确认才保存；
- 日志不含 JWT、OTP、邮箱、audio、transcript、invite token 或 provider response；
- 另建更高 versionCode、同 certificate 的内部候选，验证后续原地升级。

任何可选 QA 记录只使用非秘密 ID，可记录 device model/OS、case result、candidate run ID、APK SHA-256、certificate SHA-256；不得记录账号、邮件、token、音频或 transcript。未执行的 case 不得写成已通过。

## GitHub Actions：发布同一候选

再次从同一 `v0.0.5` tag ref 手动运行同一 workflow：

- `operation=publish`
- 相同 `tag`
- 相同 `backend_fingerprint`
- `candidate_run_id=<successful candidate run ID>`
- `expected_apk_sha256=<exact candidate APK SHA-256>`

`production-publish` 审批后，publish job：

1. 校验 candidate run 属于同仓库、已成功、是 manual run，且 `head_sha` 等于 tag commit；
2. 下载指定 run 的指定 artifact；
3. 要求 artifact 恰好三份文件；
4. 比较 metadata 中的 tag/commit/version/versionCode/backend/run/APK/certificate；
5. 重新执行 checksum、certificate、application ID、version/versionCode 和 arm64 检查；
6. 拒绝覆盖任何同名公开 asset；
7. 只上传 unchanged APK 和 `.sha256`。

publish job 没有 Android signing secrets，也没有 build step。

## 发布后

从公共 GitHub Release 重新下载 APK 和 `.sha256`：

- 校验 SHA-256 等于 `expected_apk_sha256` 和 candidate metadata；
- 校验证书等于永久 fingerprint；
- 校验 application ID、version/versionCode 与 arm64 ABI；
- 确认 Release 只有预期 Android APK 和 checksum；
- 不把未执行的 clean install、登录、RLS 读写、升级、麦克风或移动网络测试写成已验证。

tag 创建/推送、candidate run、公开 Release 和任何 asset upload 都是显式外部操作；仓库脚本不会隐式执行。
