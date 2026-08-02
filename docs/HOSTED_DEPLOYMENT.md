# Azure 自托管 Supabase 部署手册

AA 依赖 Supabase Auth、PostgREST/RLS/RPC、Realtime 和 Edge Functions，不能只部署 PostgreSQL。本仓库保留以下两种模式：

- `dual-stack`：默认合同，在合规容量主机上运行 staging 与 production 两个完整隔离栈；
- `single-stack`：必须逐命令显式传入 `--profile single-stack`，只允许运行 production。

| 环境 | Stack ID | 公共 API | Loopback Kong | 数据根目录 |
| --- | --- | --- | --- | --- |
| staging | `aa-staging-primary` | `https://aa-staging-api.cornna.xyz` | `127.0.0.1:18100` | `/srv/aa/staging` |
| production | `aa-production-primary` | `https://aa-api.cornna.xyz` | `127.0.0.1:18101` | `/srv/aa/production` |

当前 Standard_B2ats_v2（2 vCPU、`MemTotal` 约 914 MiB、4 GiB swap、Debian 11）使用 `single-stack` 是 operator 明确批准的 deliberate deviation。它不改变也不降低默认 `dual-stack` 合同。

本文和仓库脚本不会授权服务器、DNS 或 GitHub mutation。每次外部变更仍需明确批准。

## 硬性 stop gates

默认 `dual-stack` 只有全部满足下列条件才可启动：

- [ ] 主机已迁移/重建到仍受安全支持的 Debian 13（最低 Debian 12）；当前 Debian 11 的 LTS 于 2026-08-31 结束，且存在 `reboot-required`，不得作为新增长期 production 的基线；
- [ ] VM 已扩容到至少 4 vCPU，且 Linux 实测 `MemTotal >= 8,388,608 KiB`；双栈与既有服务建议 16 GiB；swap 不计入物理内存门；
- [ ] `/srv/aa` 所在 filesystem 与 Docker `DockerRootDir` 所在 filesystem 各有至少 40 GiB 可用空间，且容量门通过；
- [ ] 聊天中曾暴露的服务器密码和 Cloudflare token 已撤销并轮换；已验证两把独立 SSH key 与回滚通道，并关闭 sshd password authentication；DNS 只用最小 Zone DNS token；
- [ ] staging/production 的 Resend、OpenAI、数据库/JWT、备份凭据完全分开；
- [ ] 备份模式已显式批准：默认 `azure-blob` 时 Azure Blob 容器和 VM managed identity 权限已配置，主机已从可信来源安装并验证 `age` 与 `azcopy`，且不使用长期 SAS URL；临时采用 `local` 时已接受同盘丢失风险并继续把 off-host copy 作为未完成 gate；
- [ ] Azure effective NSG 已确认只开放批准的 22/80/443，或 WARP UDP 28526 例外已经明确批准；host INPUT=ACCEPT 不能替代控制面证据；
- [ ] `aa-api.cornna.xyz`、`aa-staging-api.cornna.xyz` 的 DNS/TLS 变更已单独批准；
- [ ] 已加密备份并恢复验证双 SSH key、Nginx/SNI、Xray unit/drop-in/config、WARP、Fail2ban、`/opt/light-panel/*` Docker bind data 与 certbot 账号/证书/续期配置，并记录回滚命令；
- [ ] source commit clean，CI、基础设施测试和独立验证通过。

明确批准的 `single-stack` 使用独立且仍然 fail-closed 的 stop gates：

- [ ] 每条相关命令显式使用 `--profile single-stack`；漏写时回到默认 `dual-stack`，不会自动降级；
- [ ] target manifest 为 `deploymentMode=single-stack`，只定义 production；env、migration 和 Nginx target 都必须是 production；
- [ ] Debian `VERSION_ID >= 11`、在线 CPU `>= 2`、物理 `MemTotal >= 917,504 KiB`（896 MiB）；4 GiB swap 和 `MemAvailable` 都不计入该硬门；
- [ ] `/srv/aa` 与 Docker `DockerRootDir` 所在 filesystem 分别至少有 `20,971,520 KiB`（20 GiB）free；即使两者是同一 filesystem 也必须完成两次路径检查；
- [ ] 上游 manifest、locked commit、function/template artifact 与 `AA_SOURCE_FINGERPRINT` 全部验证通过；
- [ ] production env 仍满足所有 secret、JWT、URL、port、backup 与 provider 校验；
- [ ] restore drill 仍使用随机 restore-only project/network/volumes，并且 drill 前 production 必须停止；
- [ ] source clean，全部仓库验证、encrypted backup、restore drill、production non-destructive canary 和恢复步骤均通过/演练。

896 MiB floor 的来源不是目标 VM 的现有数值：七个服务的明确上限合计 688 MiB（PostgreSQL 256、template 16、GoTrue 64、PostgREST 32、Realtime 96、Edge Runtime 144、Kong 80），再加现有 Xray/beszel/beszel-agent/uptime-kuma 约 130 MiB 和 Debian kernel/host daemon 78 MiB。`AA_MIN_CPUS`、`AA_MIN_MEMORY_KIB`、`AA_MIN_DISK_KIB` 只能提高当前 profile 的门，不能降低。

operator 同时明确接受：没有 staging validation；所有变更直接进入 production；PostgreSQL 在压力下可能触及 swap；914 MiB 主机仍有 host OOM 或单容器 OOM 风险；Xray、beszel、beszel-agent 和 uptime-kuma 与 production 共享 CPU、RAM、swap 和磁盘。低于任一所选 profile gate 时只允许本地仓库验证，不得起远端容器、改 DNS、签证书或发布 APK。

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

复制 ignored target manifest，然后核对显式模式、固定 server、region、stack 和 API origin。仓库 example 是 production-only opt-in：

```bash
cp supabase/hosted-targets.example.json supabase/hosted-targets.json
node scripts/hosted-deployment.mjs deployment-mode
node scripts/hosted-deployment.mjs validate-target production
```

新建的 schema v3 dual-stack manifest 必须显式写 `deploymentMode=dual-stack` 并同时提供 staging/production；已有 schema v2 manifest 继续按默认 dual-stack 合同读取。single-stack manifest 若偷偷包含 staging 会 fail closed。staging destructive suite 在 single-stack mode 不存在，也绝不能改为指向 production。

## Runtime artifact

single-stack 只在 production 根目录准备 verified upstream 和 function artifact：

```bash
sudo infra/supabase-selfhost/scripts/prepare-upstream.sh /srv/aa/production/runtime
sudo infra/supabase-selfhost/scripts/build-functions.sh /srv/aa/production/runtime
```

dual-stack 则分别为 staging 和 production 准备相同 fingerprint。`build-functions.sh`：

1. 读取 fixed upstream router；
2. 用固定 lock 对三个 AA function 和 router 执行 Deno bundle；
3. 以 source fingerprint 作为 immutable artifact 目录；
4. 将函数和 OTP template 设为只读；
5. production Compose 只读挂载 artifact，不挂载 Git 工作区。

`prepare-upstream.sh` 为保留的 upstream 文件生成包含 path/type/mode/SHA-256 的严格 manifest；`build-functions.sh` 在 bundle 前、`compose.sh` 在任何 Compose 操作前都会重新校验完整 upstream manifest。`compose.sh` 同时按 `AA_SOURCE_FINGERPRINT` 和 locked upstream commit 重新校验 function/template artifact。dual-stack 两个环境的 fingerprint 必须相同；single-stack 仍必须与本次批准的 source fingerprint 完全相同。

## Secret-safe env

single-stack 由 operator 在受限 secret manager 中创建一个 production `0600` JSON 文件，只含 `SMTP_PASS` 和 `OPENAI_API_KEY`。不要把值放进 shell argv、history、日志或 evidence。然后生成 server env：

```bash
sudo python3 infra/supabase-selfhost/scripts/generate-env.py \
  production /srv/aa/production/stack.env \
  --profile single-stack \
  --destination local \
  --fingerprint <64-HEX-SOURCE-FINGERPRINT> \
  --smtp-admin-email <VERIFIED-PRODUCTION-SENDER> \
  --publishable-key <ENVIRONMENT-SPECIFIC-SB-PUBLISHABLE-KEY> \
  --provider-secrets <ROOT-ONLY-PRODUCTION-PROVIDER-JSON> \
  --backup-recipient <AGE-PUBLIC-RECIPIENT>
```

`--destination` 只接受 `local` 或 `azure-blob`；`azure-blob` 是默认值。选择默认 Azure 模式时，仍必须同时提供 `--azure-storage-account <STORAGE-ACCOUNT>` 和 `--azure-storage-container <PRODUCTION-CONTAINER>`；local 模式会把 `BACKUP_DESTINATION=local` 写入 env，且不要求或伪造 Azure 配置。

已有 deployment 不得重新运行 generator，因为它会生成新的数据库/JWT 等 credential。升级旧 `stack.env` 时，先停止变更并备份原文件，然后在批准的新 source checkout 中计算 fingerprint、准备 upstream 并构建对应 immutable artifacts：

```bash
fingerprint="$(node scripts/hosted-deployment.mjs fingerprint | \
  node -e "let v='';process.stdin.on('data',c=>v+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(v).bundleSha256))")"
sudo infra/supabase-selfhost/scripts/prepare-upstream.sh /srv/aa/production/runtime
sudo infra/supabase-selfhost/scripts/build-functions.sh /srv/aa/production/runtime
sudo python3 infra/supabase-selfhost/scripts/migrate-gateway-keys.py \
  /srv/aa/production/stack.env \
  /srv/aa/production/stack.env.migrated \
  --fingerprint "$fingerprint" \
  --publishable-key <EXACT-KEY-ALREADY-CONFIGURED-FOR-THE-CLIENT>
sudo python3 infra/supabase-selfhost/scripts/validate-env.py \
  /srv/aa/production/stack.env.migrated \
  --profile single-stack \
  --destination local \
  --require-root-owner
```

migration 脚本拒绝覆盖输入/输出，保留既有 credential 与其他配置，只更新 `AA_SOURCE_FINGERPRINT`、`AA_FUNCTIONS_DIR`、`AA_TEMPLATE_DIR` 指向刚验证的 artifacts，并在 `SERVICE_ROLE_KEY` 后加入 public key 和新生成的 `sb_secret_*`。逐项确认 diff 仅包含这五项预期变化后，先运行 `sudo infra/supabase-selfhost/scripts/compose.sh --profile single-stack /srv/aa/production/stack.env.migrated config` 验证新 env/upstream/artifacts，才可在独立生产变更审批下原子替换 `stack.env` 并重建 Kong；本轮代码修复不执行该操作。

新生成或迁移后的 env 均须校验：

```bash
sudo python3 infra/supabase-selfhost/scripts/validate-env.py \
  /srv/aa/production/stack.env \
  --profile single-stack \
  --destination local \
  --require-root-owner
```

single-stack 不调用 `validate-pair.py`，因为没有 pair。该跳过明确表示 staging/production identity、data、port、provider 和 secret isolation proof **没有执行**；脚本没有被删除或放宽，切回 dual-stack 时仍必须对两个 env 运行它。

env 文件必须 root-owned `0600`，不得提交或上传。APK 只获得 production origin 和 anon/public key；service-role、JWT、SMTP 和 OpenAI 永不进入 `VITE_*`。

当前 stack 同时保留 legacy HS256 anon/service JWT，并在 Kong 登记环境绑定的 opaque `sb_publishable_*` / `sb_secret_*` key。pinned upstream entrypoint 会把 opaque key 转换为已验证的内部 `anon` / `service_role` JWT；validator 同时校验两类 credential，staging 与 production 不得复用。`sb_secret_*` 只允许存在于 root-owned `0600` runtime env，绝不能进入 `VITE_*`、APK、日志或 evidence。

## 容量与启动

先只读核对 CPU、物理内存、swap、`/srv/aa`、Docker data root 和各自 filesystem：

```bash
nproc
awk '/^MemTotal:/ {print $2 " KiB"}' /proc/meminfo
swapon --show
sudo docker info --format '{{.DockerRootDir}}'
df -Pk /srv/aa "$(sudo docker info --format '{{.DockerRootDir}}')"
sudo infra/supabase-selfhost/scripts/capacity-check.sh \
  --profile single-stack \
  /srv/aa "$(sudo docker info --format '{{.DockerRootDir}}')"
```

single-stack 的 exact floor 是 2 CPU、917,504 KiB physical RAM、两个路径各 20,971,520 KiB free、Debian 11；dual-stack 保持 4 CPU、8,388,608 KiB、两个路径各 41,943,040 KiB free、Debian 12。swap 只能缓解峰值压力，永远不能替代 `MemTotal` 门。`compose.sh` 在读取 DockerRootDir 前先 gate `/srv/aa`，之后再对 `/srv/aa` 和 DockerRootDir 执行同一 profile 的完整 gate。

确认现有监听、容器和磁盘；不要把外部端口扫描直接解释为 VM listener：

```bash
sudo ss -lntup
sudo docker ps --format '{{.Names}} {{.Ports}}'
sudo nft list ruleset
```

启动 production 前必须再次批准本次 mutation：

```bash
sudo infra/supabase-selfhost/scripts/compose.sh \
  --profile single-stack /srv/aa/production/stack.env pull
sudo infra/supabase-selfhost/scripts/compose.sh \
  --profile single-stack /srv/aa/production/stack.env up -d
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
  --profile single-stack \
  --expected-environment production \
  --env-file /srv/aa/production/stack.env \
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
- Resend SMTP；dual-stack 的 staging/production sender 和 credential 分开；single-stack 只保留 production credential；
- OpenAI `gpt-4o-transcribe`；key 只在 Edge Runtime；
- Edge gateway `VERIFY_JWT=true`，handler 继续调用 `auth.getUser()`；
- ASR 8 MiB/60 秒、quota 和 55 秒 proxy timeout 继续执行；
- gateway 与 TLS access log 关闭，日志不得含 JWT、OTP、邮箱、audio、transcript、invite token 或 provider body。

上线前验证 SPF、DKIM 和 DMARC monitoring。OTP evidence 只记录 case ID、延迟和结果，不记录地址、code 或正文。

## Nginx、DNS 与 TLS

模板：

- `templates/nginx/aa-api.conf.template`
- `templates/nginx/site-stream-map.conf.example`

single-stack 只渲染 production：

```bash
python3 infra/supabase-selfhost/scripts/render-nginx.py \
  production infra/supabase-selfhost/templates/nginx/aa-api.conf.template \
  /tmp/aa-production-api.conf \
  --profile single-stack
```

执行顺序：

1. Cloudflare 创建 DNS-only A records 指向 `40.115.207.13`；token 只通过受保护 input；
2. 验证 authoritative DNS；
3. 使用 DNS-01 或与现有 80/443 路由兼容的 webroot 签发 production 证书；dual-stack 才签发第二个 staging 证书；
4. 备份 Nginx config 与 `/etc/sota-vless-hy/site-stream-map.conf`；
5. 安装 loopback TLS vhost；
6. single-stack 只增加 `aa-api.cornna.xyz` exact SNI → `127.0.0.1:18544`；dual-stack 另加 staging → `127.0.0.1:18543`；
7. `nginx -t` 成功后 reload；失败立刻恢复备份；
8. 验证 `panel4.cornna.xyz`、`cfv4.cornna.xyz`、Xray 和新增 production API host；
9. 演练自动续期。

HTTPS gate：可信证书、TLS 1.2+、正确 SNI、HSTS、WebSocket upgrade、ASR 9 MiB transport envelope/55 秒、Kong CORS allowlist 和无内部端口暴露。

## Health 与 single-stack acceptance

```bash
sudo infra/supabase-selfhost/scripts/health-check.sh \
  /srv/aa/production/stack.env
```

single-stack 没有 staging，因此不具备以下原 dual-stack 证明：先在隔离 staging 执行 Auth/OTP edge cases、REST/RPC/RLS、Realtime、functions、provider error/timeout、log privacy 和 destructive cleanup，再以相同 fingerprint promotion。这个缺口是 operator 明确接受的风险，不得把 production 当成 staging，也不得对 production 运行 `verify-backend.mjs`、service-role/admin fixture 或 destructive suite。

替代但不等价的 production gates 是：全部本地/CI contract tests、isolated restore drill、non-destructive ordinary-user production canary、health check、日志隐私抽查、加密备份结构与 checksum 校验（Azure 模式另含 Blob read-back）、资源/OOM/Swap 告警。任何一项失败都停止变更并走 forward fix。

## Backup 与 restore drill

第一版能力只声明每日 encrypted logical backup，默认 RPO 24h、RTO 4h；没有实施 PostgreSQL base backup/WAL archive 前不得声称 PITR。

`backup.sh` 的 `--destination` 只接受 `local` 或 `azure-blob`，且默认仍是 `azure-blob`，因此省略 flag 时原 Azure 行为不变。Azure 模式要求 VM managed identity 对 production Blob container 有最小读写权限，用于上传后的 read-back 校验；先安装 `age`、`azcopy`。container 必须在 Azure 侧配置已批准的 lifecycle retention、soft delete/versioning，并按组织要求启用 immutability；这些是外部配置 gate，不能由本仓库脚本或本地 30 天清理代替。

当前 operator 明确选择临时 local-only。接受的风险是：加密备份与数据库位于同一台主机的同一块磁盘上，磁盘丢失会同时丢失数据库和备份。local-only 备份不防主机磁盘损坏、丢失或被破坏；在建立并验证 off-host copy 之前，这不能称为真正的 disaster-recovery plan。

两种模式都先创建固定的 root-only 非 symlink 目录：

```bash
sudo install -d -o root -g root -m 0700 /srv/aa/backups/production
```

当前 local-only 的精确每日命令是：

```bash
sudo infra/supabase-selfhost/scripts/backup.sh \
  --destination local \
  /srv/aa/production/stack.env
```

Azure 模式可显式写成 `sudo infra/supabase-selfhost/scripts/backup.sh --destination azure-blob /srv/aa/production/stack.env`，也可省略 flag 使用同一默认值。

脚本在两种模式下都先持有该 stack 的 backup lock，再选择 UTC timestamp；把 custom-format `pg_dump` 同时流经同一数据库容器的 `pg_restore --list` 和 age encryption，不在 host 写明文 archive。两种模式都要求 `age`、非空且结构有效的 custom archive、SHA-256 checksum，并且只在加密 pipeline 成功后以 no-clobber 原子链接分别发布 `.age` 与 checksum；目标文件已存在时 fail closed。新 archive 保留 owner/ACL；旧版以 `--no-owner --no-acl` 生成的 archive 不得作为 privilege recovery 或 production promotion 证据。Azure 模式才额外要求 `azcopy`，用 managed identity 上传并下载到 mode-restricted 临时目录复核远端 ciphertext；local 模式只跳过该远端上传与 read-back。两种模式都只按 exact environment filename pattern 清理本地 30 天前文件。调度器必须对非零退出告警，并每天监控最新成功备份年龄。

production promotion 前必须用 `compose.restore.yml` 做 database-only restore drill。该 Compose 只有固定 digest 的 PostgreSQL，不包含 gateway、Auth、Realtime、Functions、SMTP/provider 配置或 host port，并连接独立的 internal network 与 `restore-db-*` volumes。

每次 drill 生成新的 root-only 环境文件；human-readable `drill-id` 为 6–31 个 lowercase alphanumeric/hyphen 字符，生成器会追加 16 个随机 hex 作为 Compose project 后缀：

```bash
sudo python3 infra/supabase-selfhost/scripts/generate-restore-env.py \
  /srv/aa/restore/<DRILL-ID>.env \
  --drill-id <UNIQUE-6-TO-31-CHARACTER-ID>
sudo python3 infra/supabase-selfhost/scripts/validate-restore-env.py \
  /srv/aa/restore/<DRILL-ID>.env \
  --profile single-stack \
  --require-root-owner \
  --disjoint-from /srv/aa/production/stack.env
```

环境文件只包含 `AA_ENVIRONMENT=restore`、随机化 `aa-restore-*` stack ID、固定 restore-only upstream 路径，以及独立 PostgreSQL/JWT secrets。validator 要求常规非 symlink 文件、root owner、mode `0600` 或更严格，并在内存中证明 stack/database/JWT 与 production 分离而不输出值或 secret digest；dual-stack 仍要求同时与 staging、production 比较。backup、checksum 和 age identity 同样必须是 root-owned、不可被 group/other 读取的非 symlink 常规文件。

Azure 模式先从 Blob 取回同名 production `.dump.age` 与 `.dump.age.sha256` 到 root-only restore 目录。local 模式不取回 Blob object，直接把 `/srv/aa/backups/production` 中同名的 encrypted backup 与 checksum 路径传给 drill；single-stack 仍会拒绝 staging 文件名。single-stack 无法安全并行容纳 production 与 restore database；先用非破坏性的 `stop` 停止 production，再执行 local-only drill：

```bash
sudo infra/supabase-selfhost/scripts/compose.sh \
  --profile single-stack /srv/aa/production/stack.env stop
sudo infra/supabase-selfhost/scripts/restore-drill.sh \
  --profile single-stack \
  --destination local \
  /srv/aa/restore/<DRILL-ID>.env \
  /srv/aa/backups/production/<BACKUP>.dump.age \
  /srv/aa/backups/production/<BACKUP>.dump.age.sha256 \
  /srv/aa/restore/<AGE-IDENTITY> \
  /srv/aa/production/stack.env
```

对已从 Blob 取回的文件运行 Azure drill 时，使用 `--destination azure-blob`（或省略该 flag）并继续传入 restore 目录中的 ciphertext/checksum 路径。两种来源都执行相同的 isolated restore-only stack、随机 project identity、checksum verification、forward-migration roll-forward，以及 schema/RLS/RPC/ownership/grant assertions。

脚本在任何解密/Docker 操作前执行部署 env disjoint、严格单行 checksum 和 identity 检查，并拒绝已有同 project label 的 container/network/volume。checksum 只证明所选 ciphertext 的完整性，不证明备份来源；当前还没有获批的离线签名/同 snapshot 数据 manifest 设计，因此不得声称 authenticated provenance 或全表字节级 fidelity。

archive 会流式解密一次用于 `PGDMP`/TOC/owner-ACL metadata 检查，再流式解密到 fresh `aa_restore`，使用 `--single-transaction --exit-on-error`；主机不落明文 archive，也不清理 bootstrap `postgres`。随后在 advisory lock 下拒绝 unknown migration、changed hash 或 non-prefix ledger，以单文件事务只应用缺失 migration suffix；完成 roll-forward 后再硬校验完整 ledger、精确 RLS table/policy、RPC、Auth relations/database roles、owner/grant、validated constraints、Auth user/profile、expense split 与每圈余额零和；任一断言失败都会非零退出。

成功或失败后都不会自动销毁栈。脚本从 project 创建前开始安装 EXIT 提示，输出带 exact `--project-name`、restore env 与 restore Compose 的 `down --volumes` 命令。先记录不含 secret/个人数据的 backup object/version identity、encrypted SHA-256、drill stack ID、source fingerprint、migration hashes、RPO/RTO 和断言结果，再单独执行该命令，并确认 production volume 仍存在。`down --volumes` 只允许这个已验证的随机 `aa-restore-*` project；不得使用 production/staging env、`--remove-orphans`、prune、glob 或按 `docker volume ls` 批量删除。

该 database-only drill 验证数据库可恢复性，不验证 GoTrue、PostgREST、Realtime、Edge Functions、SMTP/provider、Nginx、DNS/TLS 或 public routing 启动；single-stack 没有 staging 覆盖，只能在清理 restore project 后用 wrapper 重启 production，运行 health check 和 production non-destructive canary。若 restore 清理、production 重启、health 或 canary 任一步失败，保持发布冻结，保留证据，恢复上一个 immutable function artifact 或从已验证 backup 启动 incident recovery；不要编辑历史 migration、reset、repair 或删除 production volume。

## Single-stack recovery expectations

该偏差的恢复目标仍是 encrypted logical backup 的默认 RPO 24h、RTO 4h，不是 PITR。operator 必须预期 restore drill 和真实 database recovery 都会造成 production downtime：先 `stop` production，确认没有该 project 的 running container，启动唯一的 restore-only database，记录 evidence 后精确清理 restore project，再用同一 `--profile single-stack` wrapper 重启 production。

重启顺序固定为：capacity/artifact gate → `compose.sh --profile single-stack ... up -d` → `health-check.sh` → ordinary-user production canary → 监控 PostgreSQL、container OOM、host OOM、swap in/out、磁盘和 backup age。若 PostgreSQL 持续使用 swap、出现 OOM kill、health 不稳定或现有 Xray/beszel/uptime-kuma 被挤压，停止新 mutation 和高成本 function 请求；不得继续降低 memory floor/limit。优先回到上一个 immutable function artifact；数据库损坏时冻结写入并从最近一次已验证 backup 走 restore-only incident procedure。

## Production promotion

single-stack 只有以下全部签署后才可单独批准 production mutation：

- operator 对本次无 staging 直接 production deviation 再次签署；
- source commit、image digest、function artifact fingerprint 与批准 evidence 相同；
- migration ledger/hash 完全匹配；
- backup 新鲜、isolated restore drill 通过；若仍是 local-only，已再次签署同盘丢失风险，且 Blob/off-host copy 仍明确记录为真正 disaster recovery 前的未完成 gate；
- DNS/TLS/SNI、监控、磁盘/内存、证书和备份年龄告警通过；
- production secret/provider/sender 只存在于受保护 production env；
- credentials 已轮换；
- privacy 必填项已补全。

production 只运行批准的 self-cleaning ordinary-user canary，不运行 `verify-backend.mjs`、seed 或 admin fixture suite。canary 需要两个预先创建且互不相同的专用账号；只接收 exact production origin、public publishable/anon key、OTP 账号、password 账号和受保护的密码，不得接收 service-role key。

先请求现有用户 OTP：

```bash
AA_SUPABASE_URL=https://aa-api.cornna.xyz \
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

- 在未显式选择并批准 `single-stack` 时在 undersized VM 部署；
- 在 dual-stack mode 下跳过 staging；single-stack 的无 staging 偏差不得被解释为已完成 isolation/acceptance proof；
- 共享 volume、stack ID、port、JWT、provider、SMTP 或 backup container；
- host bind PostgreSQL/Kong admin/内部服务；
- `latest`、未固定镜像或未校验上游文件；
- remote seed、Studio ad-hoc schema edit、production destructive suite；
- 将 secret、audio、transcript、OTP、邮箱、invite token 或 provider body写入 Git、argv、日志、artifact、截图或 evidence；
- restore drill、production canary、privacy 或 publication approval 未完成时公开 APK；真机 QA 经批准可豁免，但 Release notes 必须明确披露安装、登录、升级、机型兼容、麦克风与移动网络行为未在真机验证。
