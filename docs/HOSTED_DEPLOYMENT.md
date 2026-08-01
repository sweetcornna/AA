# Azure 自托管 Supabase 部署手册

AA 依赖 Supabase Auth、PostgREST/RLS/RPC、Realtime 和 Edge Functions，不能只部署 PostgreSQL。本手册规定在 Azure VM `40.115.207.13` 上运行两个完整隔离栈：

| 环境 | Stack ID | 公共 API | Loopback Kong | 数据根目录 |
| --- | --- | --- | --- | --- |
| staging | `aa-staging-primary` | `https://staging-api.cornna.xyz` | `127.0.0.1:18100` | `/srv/aa/staging` |
| production | `aa-production-primary` | `https://api.cornna.xyz` | `127.0.0.1:18101` | `/srv/aa/production` |

本文和仓库脚本不会授权服务器、DNS 或 GitHub mutation。每次外部变更仍需明确批准。

## 硬性 stop gates

当前 VM 只有 2 vCPU、约 1 GiB RAM，禁止部署。开始 staging 前必须全部满足：

- [ ] 主机已迁移/重建到仍受安全支持的 Debian 13（最低 Debian 12）；当前 Debian 11 的 LTS 于 2026-08-31 结束，且存在 `reboot-required`，不得作为新增长期 production 的基线；
- [ ] VM 已扩容到至少 4 vCPU，且 Linux 实测 `MemTotal >= 8,388,608 KiB`；双栈与既有服务建议 16 GiB；swap 不计入物理内存门；
- [ ] `/srv/aa` 所在 filesystem 与 Docker `DockerRootDir` 所在 filesystem 各有至少 40 GiB 可用空间，且容量门通过；
- [ ] 聊天中曾暴露的服务器密码和 Cloudflare token 已撤销并轮换；已验证两把独立 SSH key 与回滚通道，并关闭 sshd password authentication；DNS 只用最小 Zone DNS token；
- [ ] staging/production 的 Resend、OpenAI、数据库/JWT、备份凭据完全分开；
- [ ] Azure Blob 容器和 VM managed identity 权限已配置，主机已从可信来源安装并验证 `age` 与 `azcopy`；不使用长期 SAS URL；
- [ ] Azure effective NSG 已确认只开放批准的 22/80/443，或 WARP UDP 28526 例外已经明确批准；host INPUT=ACCEPT 不能替代控制面证据；
- [ ] `api.cornna.xyz`、`staging-api.cornna.xyz` 的 DNS/TLS 变更已单独批准；
- [ ] 已加密备份并恢复验证双 SSH key、Nginx/SNI、Xray unit/drop-in/config、WARP、Fail2ban、`/opt/light-panel/*` Docker bind data 与 certbot 账号/证书/续期配置，并记录回滚命令；
- [ ] source commit clean，CI、基础设施测试和独立验证通过。

低于任一 gate 时只允许本地仓库验证，不得起远端容器、改 DNS、签证书或发布 APK。

## 架构与暴露面

`infra/supabase-selfhost/compose.base.yml` 只运行：

- PostgreSQL 17；
- GoTrue/Auth；
- PostgREST；
- Realtime；
- Kong；
- Edge Runtime；
- 内部只读 OTP template server。

Studio、Analytics、Storage、imgproxy、Meta、Supavisor、GraphQL、MCP 都不在运行栈。只有 Kong 映射 host port，且必须是 loopback。PostgreSQL 和内部服务无 host bind。外部只开放 22/80/443；数据库管理只能通过 localhost/SSH tunnel。

所有核心镜像均在 `upstream.lock` 中固定 OCI image index digest。官方 Supabase commit `0e5c073b464b76a1046ff3e9a8467ebbb41a376d` 的完整归档、Compose 和 env example 都做 SHA-256 校验。禁止 `latest`、临时换 tag 或手工复制未经校验的上游初始化文件。

## 仓库 gate

在 clean checkout 执行：

```bash
npm ci
npm run typecheck
npm test
npm run test:deployment
npm run test:infrastructure
```

```bash
python3 -m compileall -q infra/supabase-selfhost/scripts infra/supabase-selfhost/tests
bash -n infra/supabase-selfhost/scripts/*.sh
shellcheck infra/supabase-selfhost/scripts/*.sh
git diff --check
```

```bash
deno check \
  --config supabase/functions/deno.json \
  --lock supabase/functions/deno.lock \
  --frozen \
  supabase/functions/agent-query/index.ts \
  supabase/functions/asr-transcribe/index.ts \
  supabase/functions/parse-expense/index.ts
```

生成不含 secret 的 source fingerprint：

```bash
node scripts/hosted-deployment.mjs fingerprint > deployment-fingerprint.json
```

该文件可进入受控 evidence；不得加入 runtime env 或 secret digest 原值。

## 目标身份

复制 ignored target manifest，然后核对固定 server、region、stack 和 API origin：

```bash
cp supabase/hosted-targets.example.json supabase/hosted-targets.json
node scripts/hosted-deployment.mjs validate-target staging
node scripts/hosted-deployment.mjs validate-target production
```

staging destructive suite 只接受 manifest 中的 staging origin；production origin 会 fail closed。

## Runtime artifact

在每个环境的数据根目录准备相同的 verified upstream 和 function artifact：

```bash
sudo infra/supabase-selfhost/scripts/prepare-upstream.sh /srv/aa/staging/runtime
sudo infra/supabase-selfhost/scripts/build-functions.sh /srv/aa/staging/runtime
```

production promotion 时对 `/srv/aa/production/runtime` 重复。`build-functions.sh`：

1. 读取 fixed upstream router；
2. 用固定 lock 对三个 AA function 和 router 执行 Deno bundle；
3. 以 source fingerprint 作为 immutable artifact 目录；
4. 将函数和 OTP template 设为只读；
5. production Compose 只读挂载 artifact，不挂载 Git 工作区。

`prepare-upstream.sh` 为保留的 upstream 文件生成包含 path/type/mode/SHA-256 的严格 manifest；`build-functions.sh` 在 bundle 前、`compose.sh` 在任何 Compose 操作前都会重新校验完整 upstream manifest。`compose.sh` 同时按 `AA_SOURCE_FINGERPRINT` 和 locked upstream commit 重新校验 function/template artifact。两个环境部署的 fingerprint 必须与 staging 已验收值完全相同。

## Secret-safe env

先由 operator 在受限 secret manager 中创建两个独立 `0600` JSON 文件，每个只含 `SMTP_PASS` 和 `OPENAI_API_KEY`。不要把值放进 shell argv、history、日志或 evidence。然后生成 server env：

```bash
sudo python3 infra/supabase-selfhost/scripts/generate-env.py \
  staging /srv/aa/staging/stack.env \
  --fingerprint <64-HEX-SOURCE-FINGERPRINT> \
  --smtp-admin-email <VERIFIED-STAGING-SENDER> \
  --provider-secrets <ROOT-ONLY-STAGING-PROVIDER-JSON> \
  --backup-recipient <AGE-PUBLIC-RECIPIENT> \
  --azure-storage-account <STORAGE-ACCOUNT> \
  --azure-storage-container <STAGING-CONTAINER>
```

production 使用独立 provider file、sender 和 Blob container。校验：

```bash
sudo python3 infra/supabase-selfhost/scripts/validate-env.py \
  /srv/aa/staging/stack.env --require-root-owner
sudo python3 infra/supabase-selfhost/scripts/validate-env.py \
  /srv/aa/production/stack.env --require-root-owner
sudo python3 infra/supabase-selfhost/scripts/validate-pair.py \
  /srv/aa/staging/stack.env /srv/aa/production/stack.env
```

env 文件必须 root-owned `0600`，不得提交或上传。APK 只获得 production origin 和 anon/public key；service-role、JWT、SMTP 和 OpenAI 永不进入 `VITE_*`。

当前 stack 使用固定 Supabase 上游仍支持的 legacy HS256 anon/service JWT。它们分别具有 `anon` 与 `service_role` claim，并由 validator 校验签名。迁移到非对称 JWT/opaque API keys 必须单独设计、轮换和验收，不能只改一个客户端 key。

## 容量与启动

扩容后先只读核对 CPU、物理内存、swap、`/srv/aa`、Docker data root 和各自 filesystem：

```bash
nproc
awk '/^MemTotal:/ {print $2 " KiB"}' /proc/meminfo
swapon --show
sudo docker info --format '{{.DockerRootDir}}'
df -Pk /srv/aa "$(sudo docker info --format '{{.DockerRootDir}}')"
sudo infra/supabase-selfhost/scripts/capacity-check.sh \
  /srv/aa "$(sudo docker info --format '{{.DockerRootDir}}')"
```

只有两个 filesystem 在 swap 扩容后仍分别保有至少 40 GiB free disk，才可用 root-owned `0600` regular file 条件增加 swap，并确保 `/etc/fstab` 只有唯一持久项。swap 只能缓解峰值压力，永远不能替代 `MemTotal` 门。`AA_MIN_CPUS`、`AA_MIN_MEMORY_KIB`、`AA_MIN_DISK_KIB` 只能提高门槛，不能低于批准的 4 CPU、8,388,608 KiB 物理内存和 40 GiB free disk；`compose.sh` 在所有 Compose 操作前会再次执行相同硬门。

确认现有监听、容器和磁盘；不要把外部端口扫描直接解释为 VM listener：

```bash
sudo ss -lntup
sudo docker ps --format '{{.Names}} {{.Ports}}'
sudo nft list ruleset
```

启动 staging 前必须再次批准本次 mutation：

```bash
sudo infra/supabase-selfhost/scripts/compose.sh \
  /srv/aa/staging/stack.env pull
sudo infra/supabase-selfhost/scripts/compose.sh \
  /srv/aa/staging/stack.env up -d
```

对 staging/production 不得使用 `docker compose down -v`、删 volume 或跨环境复用 env。唯一例外是下文经过随机 project/env 校验的 restore-only 精确清理命令。

## Migrations

`run-migrations.py` 在一个 PostgreSQL session 内持有 advisory lock，并维护 `aa_deploy.schema_migrations(filename, sha256)`：

- 按 `0001`–`0012` 顺序应用；
- 单文件事务；
- 已应用 hash 改变立即失败；
- 只允许新增 forward migration；
- 不执行 `supabase/seed.sql`。

```bash
sudo python3 infra/supabase-selfhost/scripts/run-migrations.py \
  --expected-environment staging \
  --env-file /srv/aa/staging/stack.env \
  --compose-file "$PWD/infra/supabase-selfhost/compose.base.yml" \
  --migrations "$PWD/supabase/migrations"
```

失败后禁止改历史 migration、repair 或回滚 schema；新增经审查的 forward-fix migration。

## Auth、OTP 与 providers

运行合同固定为：

- email/password signup enabled；email confirmation disabled，因此 signup 立即返回 session；
- existing-user-only 6 位 email OTP；有效期 600 秒，重发间隔 60 秒；
- phone、anonymous、OAuth、TOTP/phone MFA disabled；
- OTP HTML 从内部 template container 读取，不对公网暴露；
- Resend SMTP；staging/production sender 和 credential 分开；
- OpenAI `gpt-4o-transcribe`；key 只在 Edge Runtime；
- Edge gateway `VERIFY_JWT=true`，handler 继续调用 `auth.getUser()`；
- ASR 8 MiB/60 秒、quota 和 55 秒 proxy timeout 继续执行；
- gateway 与 TLS access log 关闭，日志不得含 JWT、OTP、邮箱、audio、transcript、invite token 或 provider body。

上线前验证 SPF、DKIM 和 DMARC monitoring。OTP evidence 只记录 case ID、延迟和结果，不记录地址、code 或正文。

## Nginx、DNS 与 TLS

模板：

- `templates/nginx/aa-api.conf.template`
- `templates/nginx/site-stream-map.conf.example`

分别渲染到临时文件：

```bash
python3 infra/supabase-selfhost/scripts/render-nginx.py \
  staging infra/supabase-selfhost/templates/nginx/aa-api.conf.template \
  /tmp/aa-staging-api.conf
```

production 同理。执行顺序：

1. Cloudflare 创建 DNS-only A records 指向 `40.115.207.13`；token 只通过受保护 input；
2. 验证 authoritative DNS；
3. 使用 DNS-01 或与现有 80/443 路由兼容的 webroot 签发两个独立证书；
4. 备份 Nginx config 与 `/etc/sota-vless-hy/site-stream-map.conf`；
5. 安装 loopback TLS vhost；
6. 在 stream map 加 exact SNI → `127.0.0.1:18543/18544`；
7. `nginx -t` 成功后 reload；失败立刻恢复备份；
8. 验证 `panel4.cornna.xyz`、`cfv4.cornna.xyz`、Xray 和新增两个 API host；
9. 演练自动续期。

HTTPS gate：可信证书、TLS 1.2+、正确 SNI、HSTS、WebSocket upgrade、ASR 9 MiB transport envelope/55 秒、Kong CORS allowlist 和无内部端口暴露。

## Health 与 staging acceptance

```bash
sudo infra/supabase-selfhost/scripts/health-check.sh \
  /srv/aa/staging/stack.env
```

staging 必须验证：

- Auth password、6 位 OTP 发送/过期/重发/错误/单次使用/限流；
- REST/RPC/RLS、Realtime、三个 function；
- invalid/missing/expired JWT；
- ASR quota、8 MiB、timeout、provider error 与一次真实小额调用；
- log privacy；
- `verify-backend.mjs` destructive suite 的 exact cleanup 和零残留。

protected runner 通过 env 注入 staging public/service key：

```bash
AA_BACKEND_TEST_MODE=staging \
AA_SUPABASE_URL=https://staging-api.cornna.xyz \
AA_SUPABASE_PUBLIC_KEY=<RUNTIME-PUBLIC-KEY> \
AA_SUPABASE_SERVICE_ROLE_KEY=<RUNTIME-SECRET> \
node scripts/verify-backend.mjs
```

禁止对 production 执行该 suite，也禁止把 service-role 放进命令历史或证据。实际 operator 应由 secret runner 注入上述 env。

## Backup 与 restore drill

第一版能力只声明每日 encrypted logical backup，默认 RPO 24h、RTO 4h；没有实施 PostgreSQL base backup/WAL archive 前不得声称 PITR。

VM managed identity 需对两个独立 Blob container 有最小读写权限，用于上传后的 read-back 校验；先安装 `age`、`azcopy`。两个 container 必须在 Azure 侧分别配置已批准的 lifecycle retention、soft delete/versioning，并按组织要求启用 immutability；这些是外部配置 gate，不能由本仓库脚本或本地 30 天清理代替。先创建固定的 root-only 非 symlink 目录：

```bash
sudo install -d -o root -g root -m 0700 \
  /srv/aa/backups/staging /srv/aa/backups/production
```

每天分别执行：

```bash
sudo infra/supabase-selfhost/scripts/backup.sh /srv/aa/staging/stack.env
sudo infra/supabase-selfhost/scripts/backup.sh /srv/aa/production/stack.env
```

脚本先持有该 stack 的 backup lock，再选择 UTC timestamp；把 custom-format `pg_dump` 同时流经同一数据库容器的 `pg_restore --list` 和 age encryption，不在 host 写明文 archive。新 archive 保留 owner/ACL；旧版以 `--no-owner --no-acl` 生成的 archive 不得作为 privilege recovery 或 production promotion 证据。脚本只在加密 pipeline 成功后以 no-clobber 原子链接分别发布 `.age` 与 checksum，用 managed identity 上传并下载到 mode-restricted 临时目录复核远端 ciphertext，且只按 exact environment filename pattern 清理本地 30 天前文件。调度器必须对非零退出告警，并每天监控最新成功备份年龄。

production promotion 前必须用 `compose.restore.yml` 做 database-only restore drill。该 Compose 只有固定 digest 的 PostgreSQL，不包含 gateway、Auth、Realtime、Functions、SMTP/provider 配置或 host port，并连接独立的 internal network 与 `restore-db-*` volumes。

每次 drill 生成新的 root-only 环境文件；human-readable `drill-id` 为 6–31 个 lowercase alphanumeric/hyphen 字符，生成器会追加 16 个随机 hex 作为 Compose project 后缀：

```bash
sudo python3 infra/supabase-selfhost/scripts/generate-restore-env.py \
  /srv/aa/restore/<DRILL-ID>.env \
  --drill-id <UNIQUE-6-TO-31-CHARACTER-ID>
sudo python3 infra/supabase-selfhost/scripts/validate-restore-env.py \
  /srv/aa/restore/<DRILL-ID>.env \
  --require-root-owner \
  --disjoint-from /srv/aa/staging/stack.env \
  --disjoint-from /srv/aa/production/stack.env
```

环境文件只包含 `AA_ENVIRONMENT=restore`、随机化 `aa-restore-*` stack ID、固定 restore-only upstream 路径，以及独立 PostgreSQL/JWT secrets。validator 要求常规非 symlink 文件、root owner、mode `0600` 或更严格，并在内存中证明 stack/database/JWT 与 staging、production 分离而不输出值或 secret digest。backup、checksum 和 age identity 同样必须是 root-owned、不可被 group/other 读取的非 symlink 常规文件。

先从 Blob 取回同名 `.dump.age` 与 `.dump.age.sha256`，再执行：

```bash
sudo infra/supabase-selfhost/scripts/restore-drill.sh \
  /srv/aa/restore/<DRILL-ID>.env \
  /srv/aa/restore/<BACKUP>.dump.age \
  /srv/aa/restore/<BACKUP>.dump.age.sha256 \
  /srv/aa/restore/<AGE-IDENTITY> \
  /srv/aa/staging/stack.env \
  /srv/aa/production/stack.env
```

脚本在任何解密/Docker 操作前执行部署 env disjoint、严格单行 checksum 和 identity 检查，并拒绝已有同 project label 的 container/network/volume。checksum 只证明所选 ciphertext 的完整性，不证明备份来源；当前还没有获批的离线签名/同 snapshot 数据 manifest 设计，因此不得声称 authenticated provenance 或全表字节级 fidelity。

archive 会流式解密一次用于 `PGDMP`/TOC/owner-ACL metadata 检查，再流式解密到 fresh `aa_restore`，使用 `--single-transaction --exit-on-error`；主机不落明文 archive，也不清理 bootstrap `postgres`。随后在 advisory lock 下拒绝 unknown migration、changed hash 或 non-prefix ledger，以单文件事务只应用缺失 migration suffix；完成 roll-forward 后再硬校验完整 ledger、精确 RLS table/policy、RPC、Auth relations/database roles、owner/grant、validated constraints、Auth user/profile、expense split 与每圈余额零和；任一断言失败都会非零退出。

成功或失败后都不会自动销毁栈。脚本从 project 创建前开始安装 EXIT 提示，输出带 exact `--project-name`、restore env 与 restore Compose 的 `down --volumes` 命令。先记录不含 secret/个人数据的 backup object/version identity、encrypted SHA-256、drill stack ID、source fingerprint、migration hashes、RPO/RTO 和断言结果，再单独执行该命令，并确认 staging/production volume 仍存在。`down --volumes` 只允许这个已验证的随机 `aa-restore-*` project；不得使用 production/staging env、`--remove-orphans`、prune、glob 或按 `docker volume ls` 批量删除。

该 database-only drill 验证数据库可恢复性，不验证 GoTrue、PostgREST、Realtime、Edge Functions、SMTP/provider、Nginx、DNS/TLS 或 public routing 启动；这些仍由 staging acceptance 和 production non-destructive canary 单独覆盖。

## Production promotion

只有以下全部签署后才可单独批准 production mutation：

- staging 稳定、destructive suite cleanup 为零；
- source commit、image digest、function artifact fingerprint 与 staging 相同；
- migration ledger/hash 完全匹配；
- backup 新鲜、Blob copy 存在、isolated restore drill 通过；
- DNS/TLS/SNI、监控、磁盘/内存、证书和备份年龄告警通过；
- production secret/provider/sender 与 staging 分开；
- credentials 已轮换；
- privacy 必填项已补全。

production 只运行批准的 self-cleaning ordinary-user canary，不运行 `verify-backend.mjs`、seed 或 admin fixture suite。canary 需要两个预先创建且互不相同的专用账号；只接收 exact production origin、public publishable/anon key、OTP 账号、password 账号和受保护的密码，不得接收 service-role key。

先请求现有用户 OTP：

```bash
AA_SUPABASE_URL=https://api.cornna.xyz \
AA_SUPABASE_PUBLIC_KEY=<PRODUCTION-PUBLIC-KEY> \
AA_CANARY_OTP_EMAIL=<DEDICATED-OTP-ACCOUNT> \
AA_CANARY_PASSWORD_EMAIL=<DEDICATED-PASSWORD-ACCOUNT> \
node scripts/verify-production-canary.mjs request-otp
```

通过批准的私密渠道取得六位 OTP 后，由 secret-safe runner 注入 `AA_CANARY_PASSWORD`、`AA_CANARY_OTP`、真实小额音频 fixture 和 MIME，再运行：

```bash
node scripts/verify-production-canary.mjs run
```

脚本覆盖 password/OTP session、匿名 RPC 拒绝、圈子/RLS/Realtime、邀请、expense、结算、零余额、三个 function 和一次真实 ASR；`0011` 的幂等 `create_canary_circle` 使用客户端预分配 UUID 和 16-hex run ID；即使服务端已提交但响应丢失，`finally` 仍能用已知 UUID 调用窄范围 `cleanup_canary_circle`。脚本在接受邀请前要求第二账号看不到 owner-only expense，随后再验证成员可读。清理只删除本次圈子数据，不删除 Auth 账号或 `asr_usage`，避免成为 quota bypass。任一步或精确清理失败都禁止 candidate。

production evidence 只记录：commit、bundle SHA-256、image digests、migration filename/hash、目标身份、测试 case/status、backup/restore ID、证书公开信息和 approver。不得记录任何 secret、个人数据或完整终端 transcript。

## Forward fix 与明确禁止

- migration 失败：停止发布，新增 forward-fix；禁止改已应用 SQL、reset、repair 或 down；
- function regression：回到已记录的 immutable function artifact；
- provider incident：禁用 `ai_settings.ai_enabled`、轮换 key，保留 rule fallback；
- Auth/SMTP incident：停止发送、恢复已批准配置、轮换 credential；
- 数据事故：冻结写入并启动 incident approval，只从已验证 backup 恢复。

禁止：

- 在 undersized VM 部署；
- staging 前部署 production；
- 共享 volume、stack ID、port、JWT、provider、SMTP 或 backup container；
- host bind PostgreSQL/Kong admin/内部服务；
- `latest`、未固定镜像或未校验上游文件；
- remote seed、Studio ad-hoc schema edit、production destructive suite；
- 将 secret、audio、transcript、OTP、邮箱、invite token 或 provider body写入 Git、argv、日志、artifact、截图或 evidence；
- restore drill、production canary、privacy 或 publication approval 未完成时公开 APK；真机 QA 经批准可豁免，但 Release notes 必须明确披露安装、登录、升级、机型兼容、麦克风与移动网络行为未在真机验证。
