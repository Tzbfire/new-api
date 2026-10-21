# New API Consumer

独立的 New API 用户应用，保留 New API / QuantumNous 归属。新页面、组件、设计系统、路由与依赖全部位于此目录，不导入 `../web`，不替换原控制台。产品与分阶段方案见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 站点品牌

公共源码使用通用站点展示，默认名称为 New API。页头、登录页、落地页和 CC Switch 导入名称复用现有 `/api/status` 的 `system_name`、`logo` 和 `server_address`，技术项目归属保留 New API / QuantumNous。站点名称、域名、专属图标及宣传文案不应写进公共源码或测试样例。

需要单独覆盖时，将 `.env.example` 复制为被 Git 忽略的 `.env.local`，配置 `PUBLIC_SITE_NAME`、`PUBLIC_SITE_DOMAIN`、`PUBLIC_SITE_TITLE`、`PUBLIC_SITE_DESCRIPTION`、`PUBLIC_SITE_LOGO_URL`。这些值只用于展示，会进入浏览器构建产物，不得放入密钥。Logo 支持站内路径、HTTP(S) 图片地址或图片 data URL；未配置或加载失败时显示通用图标。构建后的标题和描述也使用同一套配置。

未配置 `PUBLIC_DEFAULT_LANGUAGE` 时，语言按已保存选择、浏览器语言、英文回退的顺序确定。部署可以设置七种受支持语言之一作为默认值，用户手动选择仍优先；选择保存在 `new-api-consumer:language`，并兼容旧版本的语言偏好。界面统一使用「服务分组」表示模型权限与计费倍率，「套餐」表示可购买的订阅。

Docker 构建排除私有 `.env.local`，可通过同名 `--build-arg PUBLIC_...` 提供非敏感展示设置，或单独构建 consumer 后挂载静态目录。未提供参数的公共镜像不包含某个部署的专属品牌或固定中文默认值。

## 开发

```sh
cd consumer
bun install --frozen-lockfile
NEW_API_BACKEND=http://127.0.0.1:3000 bun run dev
```

打开 `http://127.0.0.1:3100/`。`/api`、`/pg` 和 `/v1` 同源反向代理至指定后端，默认 3000；不能将 API Key 放进前端环境变量。旧控制台与版本切换由后端负责，需运行支持本文入口分流的后端。没有可用后端时将显示错误状态，生产页面不会填充演示余额、假模型或假作品。

## 独立发布

```sh
bun run typecheck
bun run lint
bun run test
bun run i18n:sync
bun run build
```

新前端页面使用站点根路径，资源使用 `/_factory/`；发布独立 `consumer/dist/` 到版本目录，Go 设置 `CONSUMER_FRONTEND_DIR` 指向当前目录。`deploy/nginx.conf` 将页面请求交给网关在响应 HTML 前选择界面，不要用 nginx 的统一 SPA fallback 吞掉旧后台或 API。首次启用此入口能力须更新 Go 后端及旧管理界面的开关；以后 consumer 静态发布可独立进行。`FRONTEND_BASE_URL` 应保持未设置，避免绕过本地双界面分流。

仓库 Dockerfile 会分别构建两套前端：旧控制台继续 embed，新版静态资源放在 `/opt/new-api/consumer`，镜像默认设置 `CONSUMER_FRONTEND_DIR` 指向该目录。可用只读挂载和环境变量覆盖为独立发布目录。推送 fork 的 `main` 后，`Publish fork image` 先运行后端测试及新版 typecheck、lint、format、i18n、测试和构建，通过后发布 amd64 镜像；不会自动切换线上容器。构建上下文排除本地数据库、环境文件和测试目录。

公开域名、`SESSION_SECRET`、`CRYPTO_SECRET`、HTTPS 刷新 Cookie 与精确可信 Origin 在前端升级时保持原配置，不能通过放宽 CORS 或更换签名密钥迁移登录。旧 `/oauth/*`、`/user/reset` 和 consumer `/app/oauth/*`、`/app/reset` 均保留，以完成升级前已发起的流程。支付回跳兼容性及联调边界见 VALIDATION.md。新端所有实际权限、模型调度、预扣、结算、退款、支付通知仍由原后端负责。

画室升级还须保留原图片存储卷、存储路径与容量配置；SQL 备份只包含图片记录，不包含图片文件。应核对实际 `IMAGE_STUDIO_MAX_STORAGE_GB` 与磁盘容量，不能把隔离验收环境的无限额设置带到生产。选中图片的 ZIP 下载先在系统临时目录完成归档再响应，需为临时目录预留相应空间，完成或失败后自动清理。生产备份迁移的已验证范围与剩余条件见 [VALIDATION.md](./VALIDATION.md)。

### 独立部署的范围

`consumer/` 有自己的依赖、构建和 `dist/`。网关从指定静态目录读取 consumer，原控制台仍从 `web/dist` embed 提供；两者没有源码或组件依赖。可以把独立发布产物以只读卷挂进网关容器。安装本次分流能力后，更新 consumer 不需替换旧 `web/dist` 或重新编译 Go。浏览器请求使用同源相对路径，`NEW_API_BACKEND` 只配置开发代理，不会成为生产静态包的 API 地址。

保留上个版本的 hash 资源目录：`CONSUMER_FRONTEND_PREVIOUS_DIRS` 为 consumer 历史目录，`LEGACY_FRONTEND_PREVIOUS_DIRS` 为旧控制台历史目录；Linux/macOS 用冒号分隔。新静态目录用原子切换，HTML 不缓存，静态文件不存在返回 404 而非 HTML，避免升级前已打开页面加载旧 chunk 时白屏。历史 `/app/*` 普通书签暂时重定向到根路径等价页，其中 `/app/subscriptions` 转到用户套餐 `/plans`；OAuth/邮件回调保持原 URL，`/app/static/*` 旧资源继续可读。前端独立发布不代表能脱离 Go 后端或兼容任意旧版 New API。

### 新增接口与兼容扩展

以下以当前仓库已提交基线 `91050b700` 与 consumer 开发工作区的差异为口径，不是与所有上游历史版本比较。新增一个报价 API 和一个界面切换入口，另有六类既有接口增强：

| 类型     | 接口或范围                                 | 新前端使用的能力                                           |
| -------- | ------------------------------------------ | ---------------------------------------------------------- |
| 新接口   | `GET /api/pricing/quote`                   | 服务端价格示例、分组倍率和可解释单价；缺失时价格展示不完整 |
| 界面入口 | `GET /frontend/switch`                     | 记忆同源界面偏好并跳转到受限页面，不创建认证权限           |
| 既有增强 | `/api/status`、`/api/option/`              | 界面是否可用、是否启用，以及管理员保存全站开关             |
| 既有增强 | `/api/oauth/state`、`/api/oauth/:provider` | consumer 回调目标与对应 OAuth 流程                         |
| 既有增强 | `GET /api/reset_password`                  | `callback_target=consumer`，邮件链接返回 `/app/reset`      |
| 既有增强 | `GET /api/user/topup/info`                 | 充值请求单位、各支付渠道最低数量及币种元数据               |
| 既有增强 | `GET /api/log/self`                        | 基于历史计费快照的可解释单价字段                           |
| 既有增强 | 画室任务返回、选中/批次/全部 ZIP 下载      | 任务请求记录关联，以及同一任务内多张图片完整下载           |

聊天 `/pg/chat/completions`、画室 `/pg/image-studio/*` 与 `/api/image-studio/*`、JWT/刷新会话、分组模型、API Key、计费、支付和套餐主要复用该基线已有接口。画室和新版会话本来就属于该基线，不能将它们误算为此次新增，也不能据此假设更早的后端已有这些能力。管理员配置的 API 地址复用 `/api/status` 中的 `api_info`，CC Switch 导入链接由前端生成，没有新增专用后端接口。

### 切回旧界面

新版以次要文字入口“切换旧版”保留回退，旧界面的主按钮“体验新版”恢复推荐体验；偏好仅决定页面界面，不参与权限或计费。后台“启用新版用户界面”对应 `frontend_setting.enabled`，关闭时全站普通页面回到旧版，优先于用户偏好。未部署或无法读取新 index 时也降级到旧页面。正在完成的 consumer OAuth/重置密码回调继续尝试加载新界面，不因切换丢失流程。

浏览器用 `localStorage['factory:frontend']` 保存 `consumer` 或 `legacy`，并与同源 `factory_frontend` 偏好 Cookie 同步。Cookie 让网关在返回 HTML 前选择正确界面；两端在 React 启动前共用 `/frontend/preference.js`，兼容历史偏好，Cookie 缺失时恢复本机选择，存储被禁用时继续正常渲染。全站关闭或资源暂不可用不会把用户原来的新版意愿改写为旧版；重新启用后仍可恢复。这里不存身份令牌，也不修改认证 Cookie。

开发环境同样由后端决定版本：Rsbuild 根据页面 HEAD 响应的 `X-Factory-Frontend` 分流，只有明确为 consumer 才使用本地热更新页面；旧版、重定向及错误交回后端。`/_factory/`、`/_rspack/` 与 HMR 请求留在开发服务器。若点击切换后仍停留在 `/frontend/switch` 并看到 404，应检查运行中的 Go 二进制是否包含此入口，而不只是检查源码是否已更新。

用户选择新版（或尚未选择版本）且构建可用时，旧用户书签跟随新版：`/pricing` → `/explore`，`/pricing/:model` → 对应模型详情，`/playground` → `/chat`，`/dashboard` 及用户统计分区、`/usage-logs/common` → `/usage`，`/console/token`、`/console/topup`、`/console/personal` 等转到对应新版页面。显式选择旧版后，这些路径仍使用原界面。管理设置 `/system-settings`、管理员套餐管理 `/subscriptions`、`/dashboard/users` 及其他管理功能保留原实现，访问管理页不再改写用户界面偏好；从后台内导航到已支持的用户页也会交回网关选择版本。无等价新版的旧聊天预设、任务/审核日志及法律页面保留原实现。新版 `/studio`、`/account`、`/usage` 等在关闭新版时转到旧版等价页，保留 URL 参数；用户套餐 `/plans` 回到旧版 `/wallet` 的套餐购买区域，不能转入仅管理员可访问的 `/subscriptions`。回滚不需要回滚数据库或删除兼容扩展。

把 Go 后端也降到更早版本属于另一项兼容性操作，需要核对数据库、会话和画室协议。新端的本机聊天记录与创作草稿不会自动变成旧端记录；账户余额、密钥、订单和服务端作品继续取决于同一后端数据。此处说明的是当前代码的部署结构，未据此执行生产切换或历史后端降级。

## 可重复的本地网关集成

```sh
# 在仓库根目录构建，再运行只连接本地合成上游的隔离测试
go build -o /tmp/new-api-consumer-test .
NEW_API_TEST_BINARY=/tmp/new-api-consumer-test node consumer/tests/gateway-integration.mjs
```

测试自行创建与清理临时 SQLite、随机测试账户和子进程，不使用生产配置，不发起真实支付。覆盖模型和分组价格、API Key 生命周期、聊天、两张图片批次、作品下载、消费结算、个人资料、会话/两步验证状态、兑换与防重复、套餐余额购买与限购及扣费偏好。

需要保留一个可体验的本地后端时，从仓库根目录运行：

```sh
mkdir -p .local-tests/factory-consumer
go build -o .local-tests/factory-consumer/new-api .
NEW_API_TEST_BINARY="$PWD/.local-tests/factory-consumer/new-api" node consumer/tests/gateway-integration.mjs --serve
```

测试通过后，网关在 `http://127.0.0.1:3000`，模拟上游在 `http://127.0.0.1:3201`；另一个终端启动上述前端即可访问 `/`。两个端口须空闲，脚本不会终止已有服务。`--serve` 会保留隔离数据，Ctrl+C 只停止本次子进程。随机登录资料位于被 Git 忽略的 `.local-tests/factory-consumer/access.json`（仅当前用户可读写），不要提交或共享此文件。此模式只连接模拟模型并使用测试余额，不能用于生产。

在 `consumer/` 中也可使用 `bun run test:gateway` / `bun run dev:gateway`，需同样提供绝对路径的 `NEW_API_TEST_BINARY`。

使用项目 `.env` 中同一台本地 PostgreSQL 实例验证完整写入流程：

```sh
NEW_API_TEST_BINARY="$PWD/.local-tests/factory-consumer/new-api" node consumer/tests/postgres-integration.mjs
```

脚本从 `.env` 读取连接配置，在同一实例创建随机命名的 `factory_consumer_test_*` 空库，跑完真实网关联调后删除自己的测试库；不会对原有 `new-api` 业务库执行初始化或注入模拟余额。需要本机 `psql` 和创建数据库权限。直接调用底层集成脚本时，`NEW_API_TEST_POSTGRES_DSN` 也只接受上述命名且无业务表的本地测试库。已有业务库的正常运行、备份及升级应与这种破坏性测试分开执行。

## 维护约定

- 功能目录为业务边界，公共交互统一复用 `src/components`，不跨项目导入旧页面或样式。
- access token、proof、API Key、OTP 和恢复码只存在内存；聊天记录按用户 ID 保存在本机，有明确 UI 提示。
- API 请求统一走 `src/lib/api.ts`；付费提交和安全操作不自动重放。仅无副作用读取可重试。
- 价格来自服务端报价；动态情景示例不能当成任意请求的固定报价。钱包额度只做展示单位换算。
- 本应用七语言目录完全独立。新增或修改文案时准备一个临时补丁 JSON，顶层为 `en`、`zh`、`zh-TW`、`fr`、`ja`、`ru`、`vi`，各对象包含相同的英文源文键及对应译文（`en` 的值等于键）；七语言都须保留相同的 `{{variable}}` 占位符。不要直接手改 locale 产物，也不保留按开发轮次回放的翻译源文件。
- 先运行 `node scripts/add-missing-keys.mjs /absolute/path/patch.json --check` 只读校验，再去掉 `--check` 应用，最后运行 `bun run i18n:sync` 和 `bun run i18n:check`。脚本全量校验后备份七语言原文件到仓库被忽略的 `.local-tests/consumer-i18n/backups/`，使用同目录临时文件逐文件原子替换，批次失败时恢复已替换文件；进程被强制中断时可从打印的备份路径恢复。重复应用同一补丁不会改变内容。
- 新接口尽量保持只读、兼容、小范围；数据库、账务或认证修改须遵循仓库根 AGENTS.md。
