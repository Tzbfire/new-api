# 余额桶严格计费方案（基于 manyou116/new-api 最新 main）

## 0. 基线确认

- 远端：`https://github.com/manyou116/new-api`
- 分支：`main`
- 已确认最新提交：`cdf950472547ea84013df74fe93520110f9a6993`
- 提交信息：`fix: stabilize Yaohuo OAuth token exchange`
- 当前本地分支：`quota-bucket-manyou-main`

本方案只基于上述提交的现有结构：后端 Go + 单套前端 `web/src`。后台开关应加入：

`系统设置 -> 分组与模型定价设置 -> 分组相关设置`

对应当前文件：

- `web/src/components/settings/RatioSetting.jsx`
- `web/src/pages/Setting/Ratio/GroupRatioSettings.jsx`

## 1. 目标

实现“余额桶表”严格方案：

- 不把用户整体分组改成 `vip`。
- 用户原有余额、注册赠送、邀请赠送、签到赠送、管理员默认加额等，仍按普通/原用户分组倍率计费。
- 用户通过充值或兑换码获得的额度，进入“付费余额桶”，按后台配置的付费权益分组倍率计费，例如 `vip`。
- 同一个用户可以同时存在普通余额桶和付费余额桶。
- 扣费时只让命中的余额桶享受它自己的倍率，不能因为用户拥有 10 额度付费余额，就让原有 50 额度也按 `vip` 倍率计费。
- 方案默认关闭；关闭时保持当前 `users.quota` 单余额逻辑。

## 2. 配置项

新增系统选项：

| Option Key | 默认值 | 说明 |
| --- | --- | --- |
| `QuotaBucketBillingEnabled` | `false` | 是否启用余额桶严格计费方案 |
| `PaidQuotaBillingGroup` | `vip` | 充值/兑换码额度使用的权益分组名，必须和后台分组倍率里的 key 一致 |

后端落点：

- 新增 `setting/quota_bucket.go`
- 修改 `model/option.go`
  - `InitOptionMap()` 注入默认值
  - `updateOptionMap()` 支持运行时更新

前端落点：

- `web/src/components/settings/RatioSetting.jsx`
  - options 初始值增加 `QuotaBucketBillingEnabled`、`PaidQuotaBillingGroup`
  - boolean 转换列表加入 `QuotaBucketBillingEnabled`
- `web/src/pages/Setting/Ratio/GroupRatioSettings.jsx`
  - `OPTION_KEYS` 加入两个新 key
  - `inputs` 加入两个字段
  - 在“分组相关设置”中新增开关和付费权益分组输入框/选择框

## 3. 数据表设计

### 3.1 `user_quota_buckets`

每一笔来源额度对应一个余额桶，保存剩余量和权益分组。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | bigint pk | 桶 ID |
| `user_id` | int index | 用户 ID |
| `billing_group` | varchar(64) index | 该桶扣费时使用的权益分组；普通桶为空或 `default`，付费桶为 `PaidQuotaBillingGroup` |
| `source` | varchar(32) index | `legacy`/`migration`/`topup`/`redemption`/`register`/`invite`/`checkin`/`admin`/`refund` |
| `source_id` | varchar(191) | 来源幂等 ID，例如充值 `trade_no`、兑换码 ID |
| `amount_total` | int | 初始额度 |
| `amount_remaining` | int index | 剩余额度 |
| `amount_used` | int | 已用额度 |
| `expires_at` | bigint index | 预留过期时间，0 表示不过期 |
| `priority` | int index | 消耗优先级，付费桶优先，普通桶靠后 |
| `status` | varchar(32) index | `active`/`inactive` |
| `created_at` | bigint | 创建时间 |
| `updated_at` | bigint | 更新时间 |

索引：

- `idx_quota_bucket_active(user_id,status,billing_group,expires_at,priority)`
- `uniq_quota_bucket_source(user_id,source,source_id)`，用于充值/兑换码回调幂等。

### 3.2 `user_quota_bucket_transactions`

记录每次入账、预扣、结算、退款和管理员调整。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | bigint pk | 交易 ID |
| `request_id` | varchar(191) index | 请求级幂等 ID，预扣/退款/结算关联使用 |
| `user_id` | int index | 用户 ID |
| `bucket_id` | bigint index | 桶 ID |
| `type` | varchar(32) index | `credit`/`migration`/`pre_consume`/`settle`/`refund`/`adjust` |
| `source` | varchar(32) | 来源 |
| `source_id` | varchar(191) | 来源 ID |
| `delta` | int | 正数入账/退款，负数扣减 |
| `balance_after` | int | 桶交易后余额 |
| `using_group` | varchar(64) | 实际请求使用分组 |
| `billing_group` | varchar(64) | 本次扣费权益分组 |
| `model_name` | varchar(255) | 模型 |
| `token_id` | int | token ID |
| `channel_id` | int | channel ID |
| `status` | varchar(32) | `done`/`reserved` 等 |
| `created_at` | bigint index | 创建时间 |

### 3.3 可选：`user_quota_bucket_charges`

为严格结算建议增加请求级汇总表，避免只靠交易表反推状态。

| 字段 | 说明 |
| --- | --- |
| `request_id` unique | 请求幂等 ID |
| `user_id` | 用户 ID |
| `status` | `reserved`/`settled`/`refunded` |
| `pre_consumed_quota` | 预扣总额度 |
| `actual_quota` | 实际结算额度 |
| `allocations_json` | 预扣时各桶分配情况 |
| `created_at`/`updated_at` | 时间 |

如果不单独建表，也必须保证 `user_quota_bucket_transactions.request_id + type` 能幂等恢复所有预扣/退款状态。

## 4. 余额来源归类

### 4.1 进入付费桶，享受 `PaidQuotaBillingGroup`

- 在线充值：`model/topup.go`
  - `CompleteTopUpPayment`
  - `Recharge` / Stripe
  - `ManualCompleteTopUp`
  - `RechargeCreem`
  - `RechargeWaffo`
  - `RechargeWaffoPancake`
- 易支付旧回调直加额度：`controller/topup.go`
- 兑换码：`model/redemption.go -> Redeem`

### 4.2 进入普通桶，不享受 VIP 倍率

- 存量迁移：`users.quota` 的既有余额懒迁移为 `legacy/default` 桶
- 注册赠送：`model/user.go`
- 邀请赠送/划转邀请额度：`model/user.go`
- 签到赠送：`model/checkin.go`
- 管理员默认加额：`controller/user.go` / `model.IncreaseUserQuota`
- 普通退款：按原请求使用的桶退回；无法关联请求的退款进入普通桶

## 5. 存量数据迁移策略

不做一次性全表迁移，采用懒迁移：

1. 开关关闭时，不创建或不使用余额桶，完全走旧逻辑。
2. 开关开启后，用户第一次发生入账/扣费/查询桶余额时执行：
   - 锁定用户行。
   - 统计该用户已有 active 桶剩余额度。
   - `legacyQuota = users.quota - sum(active.amount_remaining)`。
   - 如果 `legacyQuota > 0`，创建 `source=migration`、`billing_group=default` 的普通桶。
3. `users.quota` 继续作为总余额兼容字段，保持现有 UI、API、余额判断可用。
4. 每次桶入账/扣费/退款，必须同步更新 `users.quota` 和 Redis quota cache。

## 6. 严格扣费算法

### 6.1 不采用的方案

不采用“只要用户有付费桶，就把整次请求按 VIP 费率计费”的方案。这个方案会让普通余额也变相享受 VIP 倍率，不符合严格要求。

### 6.2 严格方案

扣费应按“计费基数”拆分，而不是按用户整体分组拆分：

1. 先计算本次请求的基础计费量 `base_amount`，即未乘用户/权益分组倍率前的额度。
   - 按 token 计费：`weighted_tokens * model_ratio`
   - 按价格计费：`model_price * QuotaPerUnit`
   - 图片/音频/cache/任务的附加倍率也应体现在 `base_amount` 内，但暂不乘分组倍率。
2. 按优先级分配 `base_amount`：
   - 先尝试付费桶：付费桶可承载的基础量为 `paid_remaining / paid_group_ratio`。
   - 付费桶不足时，剩余基础量再走普通桶，普通桶使用用户原分组/实际 using group 的倍率。
3. 每段实际扣费：`segment_quota = segment_base_amount * segment_group_ratio`。
4. 总扣费：`sum(segment_quota)`。
5. 每段只扣对应 `billing_group` 的桶，不跨桶享受倍率。

举例：

- 用户普通余额 50，付费余额 10。
- `vip` 倍率 0.5，普通倍率 1。
- 某请求基础量为 30。
- 付费桶最多承载基础量 `10 / 0.5 = 20`，扣付费余额 `20 * 0.5 = 10`。
- 剩余基础量 10 扣普通余额 `10 * 1 = 10`。
- 最终：付费桶扣 10，普通桶扣 10，总扣费 20；不会让普通 50 全部按 vip 倍率。

### 6.3 预扣/结算/退款

需要在 `relayInfo` 或 `PriceData` 中保存请求的分段计费计划：

```go
type QuotaChargeSegment struct {
    BillingGroup string
    GroupRatio   float64
    BaseAmount   float64
    Quota        int
}
```

预扣：

- 创建 `request_id`。
- 根据预估 `base_amount` 生成 segments。
- 对每个 segment 锁定对应 active buckets，按优先级扣 `amount_remaining`。
- 写 `pre_consume` 交易和请求级汇总。
- 同步扣 `users.quota` 与 token quota。

结算：

- 根据真实 usage 重新计算 actual segments。
- 与预扣 segments 比较差额。
- 多扣：按原 segment/原 bucket 退款。
- 少扣：继续按相同优先级补扣；如果付费桶已不足，只能扣普通桶并按普通倍率重新计算剩余基础量，不能继续用 VIP 倍率透支。

退款：

- 按 `request_id` 找到预扣/结算交易，原路退回对应 bucket。
- `Refund()` 必须幂等，避免重试多退。

## 7. 代码落点

### 7.1 后端模型层

新增：

- `setting/quota_bucket.go`
- `model/quota_bucket.go`

修改：

- `model/main.go`
  - `migrateDB()` 和 `migrateDBFast()` 加新表 `AutoMigrate`
- `model/option.go`
  - 新配置项读写
- `model/user.go`
  - `IncreaseUserQuota`：开关开启时默认进入普通桶
  - `DecreaseUserQuota`：开关开启时按普通桶/全桶规则扣减
  - `TransferAffQuotaToQuota`：邀请额度划转进入普通桶
- `model/checkin.go`
  - 签到奖励进入普通桶
- `model/topup.go`
  - 所有充值成功路径进入付费桶
- `controller/topup.go`
  - 旧易支付直接回调路径改成统一充值入桶 helper
- `model/redemption.go`
  - 兑换码进入付费桶
- `controller/user.go`
  - 管理员 add/subtract/override 与桶同步

### 7.2 后端计费层

修改：

- `relay/common/relay_info.go`
  - 保存 `BillingGroup`、`QuotaChargeSegments`、`RequestId` 等
- `relay/helper/price.go`
  - 将分组倍率计算拆成“基础计费量 + 分段分组倍率”
- `service/funding_source.go`
  - `WalletFunding` 改成桶感知，保存 request_id、segments、allocations
- `service/billing_session.go`
  - 预扣/结算/退款使用桶事务
  - 启用桶计费时关闭 trust quota 旁路，避免未预扣导致无法知道消耗哪个桶
- `service/quota.go`
  - `PostConsumeQuota` 兼容未走 BillingSession 的钱包扣费路径
  - WSS 音频/实时扣费需要桶感知
- `service/task_billing.go`
  - 异步任务差额结算/退款通过 `request_id` 找回桶交易
- `model/task.go`
  - `TaskPrivateData` 保存 `request_id`、`billing_group` 或 charge id
- `service/log_info_generate.go`
  - consume log 的 `other` 写入 `billing_source`、`billing_group`、`request_id`、segments 摘要

### 7.3 需要重点覆盖的入口

- 普通文本/聊天：`controller/relay.go -> service.PreConsumeBilling -> service.SettleBilling`
- 任务：`relay/relay_task.go`、`service/task_billing.go`
- Midjourney/MJ proxy：`relay/mjproxy_handler.go`、`controller/midjourney.go`
- Realtime/WSS 音频：`service/quota.go`
- 违规扣费：`service/violation_fee.go`
- 兑换码/充值/签到/邀请/后台调整

## 8. 兼容和回滚

- 开关默认关闭，关闭时不改变旧逻辑。
- 新表只新增，不修改现有表语义。
- `users.quota` 始终保持总余额，便于回滚。
- 回滚方式：关闭 `QuotaBucketBillingEnabled` 即可回到旧单余额扣费。
- 不建议删除新表；保留审计记录。
- 如果需要彻底回滚，可先确认：

```sql
SELECT user_id, SUM(amount_remaining) FROM user_quota_buckets WHERE status='active' GROUP BY user_id;
```

与 `users.quota` 对账后再处理。

## 9. 验证计划

### 9.1 后端单元/集成测试

使用 Docker Go 容器执行，避免依赖本机 Go：

```bash
docker run --rm -v "$PWD":/src -w /src golang:1.24 bash -lc 'go test ./model ./service ./relay/helper'
```

本地构建测试如需运行，限制 4 核：

```bash
docker buildx build --builder newapi-cpulimit4 --load -t new-api:quota-bucket-test .
```

### 9.2 必测场景

1. 开关关闭：充值、兑换码、普通调用行为与旧版本一致。
2. 开关开启，存量用户首次扣费：自动生成 legacy 普通桶，`users.quota` 不变。
3. 用户普通余额 50，充值 10：
   - 普通桶 50。
   - 付费桶 10。
   - 用户 `users.group` 不变。
4. 小请求只消耗付费桶：按 `PaidQuotaBillingGroup` 倍率扣费。
5. 大请求跨桶：付费桶只承担其可覆盖基础量，剩余走普通桶倍率。
6. 兑换码额度进入付费桶。
7. 邀请/注册/签到额度进入普通桶。
8. 失败请求退款：按原 bucket 原路退回，重复退款不多退。
9. 流式请求结算：预扣和实际扣费差额正确。
10. 异步任务失败/补扣：重启后仍能通过 `request_id` 正确退款/结算。
11. 订阅优先用户：订阅扣费不使用余额桶；订阅不足回退钱包时再使用桶计费。
12. Redis quota cache 与 `users.quota`、bucket sum 一致。

## 10. 实施顺序

1. 只新增配置项和前端开关，默认关闭。
2. 新增表结构和模型 helper，但不接入扣费路径。
3. 接入入账路径：充值/兑换码进入付费桶，赠送进入普通桶。
4. 接入钱包预扣/退款/结算，先覆盖普通 relay。
5. 覆盖任务、MJ、WSS、违规扣费等旁路。
6. 加 consume log 审计信息。
7. 用生产数据副本在 `newapi-test` compose 中验证。
8. 验证通过后再推送到 `https://github.com/Tzbfire/new-api` 构建镜像。

## 11. 风险点

- 当前代码中仍存在少数直接 `Update("quota", gorm.Expr(...))` 路径，必须全部替换为统一 helper，否则桶余额和 `users.quota` 会不一致。
- 分段计费需要保存请求级状态，否则流式结算、异步任务、失败退款容易错桶。
- `PaidQuotaBillingGroup` 必须和后台分组倍率 key 完全一致；大小写不一致会导致倍率不是预期。
- 开启后建议先在测试环境跑生产数据副本对账，再在生产打开开关。
