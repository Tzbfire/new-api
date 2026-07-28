# 邀请实际消耗返利方案（每日结算）

## 目标

实现一个“邀请返利”功能：

- 管理员可以在现有“额度设置”位置配置返利比例。
- 管理员可以在同一位置选择返利到账的额度桶，例如 `default` 免费桶、`VIP` 桶或其它已配置分组。
- 被邀请人不是购买时立刻触发返利，而是在其实际消耗符合条件的额度后记录待返利事件。
- 系统每天结算一次，将返利额度发放给邀请人。
- 邀请人可以在日志/返利记录中查询到账明细。
- 保持幂等，避免支付回调、请求重试、任务补偿导致重复返利。

## 当前代码基础

现有相关结构：

- `users.inviter_id`：被邀请人的邀请人 ID。
- `users.aff_code`：邀请码。
- `users.aff_quota` / `users.aff_history`：现有注册邀请奖励统计。
- `common.QuotaForInviter` / `common.QuotaForInvitee`：注册时固定赠送额度。
- quota bucket：
  - `user_quota_buckets`
  - `user_quota_bucket_transactions`
  - `QuotaBucketBillingGroupDefault`
  - `QuotaBucketSourceInvite`
  - `CreditUserQuotaBucket(...)`
  - `creditUserQuotaBucketTx(...)`

现有购买入口：

- 兑换码：`model.Redeem(...)`
- 普通充值：`model.Recharge(...)`、`RechargeCreem(...)`、`RechargeWaffo(...)`、`RechargeWaffoPancake(...)`
- 订阅网关支付：`model.CompleteSubscriptionOrder(...)`
- 余额/VIP bucket 购买订阅：`PurchaseSubscriptionWithBalance(...)`、`PurchaseSubscriptionWithWallet(...)`

## 功能定义

### 返利模式

采用“实际消耗返利”：

```text
被邀请人实际消耗 eligible 额度 -> 写入待结算事件 -> 每日汇总 -> 给邀请人发放返利
```

不是购买时立刻给返利。

### eligible 消耗范围

V1 建议只返利以下实际消耗：

1. 被邀请人使用兑换码获得的额度被实际消耗。
2. 被邀请人通过支付网关充值获得的额度被实际消耗。
3. 被邀请人通过支付网关购买订阅，订阅额度被实际消耗。

不返利：

- 注册赠送额度。
- 签到额度。
- 管理员赠送额度。
- 邀请返利额度本身。
- 免费额度桶消费，除非该桶本身来自兑换码/网关支付。
- 余额购买订阅。
- VIP bucket 余额购买订阅。
- 管理员绑定订阅。

### 返利额度计算

```text
返利额度 = eligible_quota * 返利比例
```

建议内部使用 bps 保存比例：

```text
100 bps   = 1%
1000 bps  = 10%
10000 bps = 100%
```

计算：

```go
rebateQuota = floor(eligibleQuota * rebateBps / 10000)
```

`rebateQuota <= 0` 时不发放，可标记为 skipped。

## 管理员设置

在现有“额度设置”区域新增配置项。

建议新增 option：

```go
AffiliateUsageRebateEnabled bool
AffiliateUsageRebateBps     int
AffiliateUsageRebateGroup   string
AffiliateUsageRebateHour    int
```

含义：

| 配置 | 含义 | 默认值 |
|---|---|---|
| `AffiliateUsageRebateEnabled` | 是否启用实际消耗返利 | `false` |
| `AffiliateUsageRebateBps` | 返利比例，bps | `0` |
| `AffiliateUsageRebateGroup` | 返利到账额度桶/计费分组 | `default` |
| `AffiliateUsageRebateHour` | 每日结算小时，按站点时区 | `0` |

前端显示建议：

```text
邀请实际消耗返利：开关
返利比例：百分比输入，例如 10 表示 10%
返利到账额度桶：下拉选择已有 GroupRatio 分组，例如 default / VIP / Codex/GPT
每日结算时间：0-23 点
```

注意：

- 不要把到账桶写死为 `default`。
- 返利到账桶必须是当前系统已存在的 group ratio key。
- 如果配置为空或不存在，后端应安全回退到 `default`，并写系统日志。
- 前端下拉的数据可以复用现有分组配置数据。

## 数据库设计

### 1. 返利消费事件表

建议新增：

```go
type AffiliateUsageRebateEvent struct {
    Id int64 `gorm:"primaryKey"`

    RequestId string `gorm:"type:varchar(191);not null;uniqueIndex"`

    InviteeId int `gorm:"index;not null"`
    InviterId int `gorm:"index;not null"`

    BillingSource string `gorm:"type:varchar(32);not null"` // wallet / subscription
    BillingGroup  string `gorm:"type:varchar(64);not null;default:''"`

    SourceType     string `gorm:"type:varchar(32);not null"` // bucket / subscription
    SourceId       string `gorm:"type:varchar(191);not null;default:''"`
    SourceProvider string `gorm:"type:varchar(50);not null;default:''"`

    ActualQuota   int64 `gorm:"not null;default:0"`
    EligibleQuota int64 `gorm:"not null;default:0"`

    RebateBps   int    `gorm:"not null;default:0"`
    RebateGroup string `gorm:"type:varchar(64);not null;default:'default'"`

    Status    string `gorm:"type:varchar(32);not null;default:'pending';index"`
    EventDate string `gorm:"type:varchar(10);not null;index"` // YYYY-MM-DD, Asia/Shanghai

    CreatedAt int64 `gorm:"not null;default:0"`
    UpdatedAt int64 `gorm:"not null;default:0"`
    SettledAt int64 `gorm:"not null;default:0"`
}
```

状态：

```text
pending  待结算
settled  已结算
skipped  无需结算，例如返利比例为 0 或返利额度为 0
failed   结算失败，可重试
```

唯一索引：

```text
request_id unique
```

作用：防止同一次请求重复产生返利事件。

### 2. 每日结算表

建议新增：

```go
type AffiliateDailyRebateSettlement struct {
    Id int64 `gorm:"primaryKey"`

    SettlementDate string `gorm:"type:varchar(10);not null;index"` // YYYY-MM-DD
    InviterId      int    `gorm:"not null;index"`

    RebateBps   int    `gorm:"not null;default:0"`
    RebateGroup string `gorm:"type:varchar(64);not null;default:'default'"`

    EventCount    int   `gorm:"not null;default:0"`
    BaseQuota     int64 `gorm:"not null;default:0"`
    RebateQuota   int64 `gorm:"not null;default:0"`

    Status string `gorm:"type:varchar(32);not null;default:'settled';index"`

    SourceId string `gorm:"type:varchar(191);not null;default:''"`

    CreatedAt int64 `gorm:"not null;default:0"`
    UpdatedAt int64 `gorm:"not null;default:0"`
}
```

唯一索引建议：

```text
settlement_date + inviter_id + rebate_group + rebate_bps
```

`SourceId` 可用于写入 quota bucket：

```text
affiliate-rebate:2026-07-27:inviter:123:group:VIP:bps:1000
```

## 购买来源归属设计

### wallet quota bucket

普通钱包消费时，如果开启 quota bucket，可以通过 `user_quota_bucket_transactions` 判断实际扣的是哪些 bucket。

可返利来源建议：

```text
topup
redemption
```

不可返利来源：

```text
register
checkin
invite
affiliate_rebate
admin
migration
refund
legacy
```

建议新增常量：

```go
QuotaBucketSourceAffiliateRebate = "affiliate_rebate"
```

### subscription

订阅消费要判断这份订阅是否来自“网关支付购买”。

当前 `UserSubscription.Source` 只有类似：

```text
order / wallet / admin
```

建议 V1 对 `UserSubscription` 补充购买快照字段，便于后续判断：

```go
PurchaseTradeNo   string `json:"purchase_trade_no" gorm:"type:varchar(191);index"`
PaymentProvider   string `json:"payment_provider" gorm:"type:varchar(50);default:''"`
PaymentMethod     string `json:"payment_method" gorm:"type:varchar(50);default:''"`
```

或者新增关联表记录订阅购买来源。

V1 简化判断：

- `CompleteSubscriptionOrder(...)` 创建订阅时写入 `trade_no/payment_provider/payment_method`。
- `PurchaseSubscriptionWithBalance(...)` / `PurchaseSubscriptionWithWallet(...)` 创建的订阅不写网关 provider，或 provider 为 `balance/wallet`。
- 每次订阅实际扣费后，只有 provider 属于网关支付才 eligible。

允许返利的 provider：

```go
stripe
epay
creem
waffo
waffo_pancake
```

不允许返利：

```go
balance
wallet
admin
空值
```

## 事件记录时机

### 统一入口

建议新增服务函数：

```go
RecordAffiliateUsageRebateEventTx(
    tx *gorm.DB,
    requestId string,
    inviteeId int,
    billingSource string,
    billingGroup string,
    actualQuota int,
    eligibleQuota int,
    sourceType string,
    sourceId string,
    sourceProvider string,
) error
```

内部逻辑：

1. 配置未启用或比例 <= 0：直接返回。
2. `inviteeId <= 0` 或 `actualQuota <= 0`：返回。
3. 查询被邀请人，拿 `inviter_id`。
4. 没有邀请人：返回。
5. 防止 `inviter_id == invitee_id`。
6. 根据配置快照记录：
   - `rebate_bps`
   - `rebate_group`
7. `eligibleQuota <= 0`：可不插入，或插入 skipped。
8. 插入事件表，依赖 `request_id unique` 保证幂等。

### wallet 消费

在钱包结算成功后记录。

如果 quota bucket 开启：

- 按 `request_id` 查询本次请求的 bucket 扣费交易。
- 汇总来源为 `topup/redemption` 的实际扣费额度。
- 作为 `eligible_quota`。

注意：

- 需要以最终实际消耗为准。
- 如果有预扣后退款，最好在结算后根据最终交易净额计算。
- 可通过 `pre_consume / settle / refund / adjust` 汇总同一 request 的净消耗。

如果 quota bucket 未开启：

- 无法精确知道这次消耗来自购买额度还是免费额度。
- V1 可选择：
  - 禁用实际消耗返利，要求开启 quota bucket。
  - 或粗略按所有钱包消耗 eligible，不推荐。

建议：**实际消耗返利依赖 quota bucket，未开启时只支持订阅消费返利或直接禁用。**

### subscription 消费

在订阅结算成功后记录。

可从 `relayInfo.SubscriptionId` 定位 `user_subscriptions`。

如果该订阅购买来源是支付网关，则：

```text
eligible_quota = actual subscription consumed quota
```

如果来源为 wallet/balance/admin，则不记录。

## 每日结算任务

新增系统任务：

```go
RunAffiliateDailyRebateSettlement(date string, limit int) error
```

定时策略：

- 默认每天 `AffiliateUsageRebateHour` 点执行。
- 结算日期为昨天。
- 使用站点时区，当前部署为 `Asia/Shanghai`。

结算流程：

1. 找出指定日期 `pending` 事件。
2. 按以下维度聚合：
   - `inviter_id`
   - `rebate_bps`
   - `rebate_group`
3. 计算：

```text
rebate_quota = floor(sum(eligible_quota) * rebate_bps / 10000)
```

4. `rebate_quota <= 0`：事件标记 skipped。
5. 写 `affiliate_daily_rebate_settlements`。
6. 给邀请人发放额度。
7. 标记对应事件为 settled。
8. 写用户日志。

发放额度：

```go
creditUserQuotaBucketTx(
    tx,
    inviterId,
    rebateQuota,
    QuotaBucketSourceAffiliateRebate,
    settlement.SourceId,
    rebateGroup,
    true,
)
```

其中 `rebateGroup` 来自管理员配置快照，不写死。

如果 quota bucket 未开启：

```go
users.quota += rebateQuota
```

但由于该功能依赖来源追踪，建议 UI 提示：

```text
实际消耗返利建议开启 quota bucket，否则无法精确区分免费额度和付费额度来源。
```

## 用户可见日志和查询

### 日志

每日结算成功后，对邀请人写日志：

```text
邀请返利到账：结算日期 2026-07-27，被邀请用户实际消耗 1000000 额度，返利比例 10%，返利 100000 额度，到账额度桶 VIP
```

日志类型：

V1 可以复用：

```go
LogTypeSystem
```

如果前端筛选改动可控，建议新增：

```go
LogTypeAffiliateRebate
```

### 用户接口

新增用户接口：

```text
GET /api/user/affiliate/rebate/settlements
GET /api/user/affiliate/rebate/events
```

V1 至少做 settlement 列表。

返回示例：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "settlement_date": "2026-07-27",
        "base_quota": 1000000,
        "rebate_bps": 1000,
        "rebate_percent": 10,
        "rebate_quota": 100000,
        "rebate_group": "VIP",
        "event_count": 32,
        "status": "settled",
        "created_at": 178...
      }
    ],
    "total": 1
  }
}
```

用户侧不要默认展示被邀请人的用户名、邮箱、请求 ID，避免隐私泄露。

### 管理员接口

管理员可查详细事件：

```text
GET /api/admin/affiliate/rebate/events
GET /api/admin/affiliate/rebate/settlements
POST /api/admin/affiliate/rebate/settle?date=2026-07-27
```

管理员明细可以包含：

```text
invitee_id
inviter_id
request_id
billing_source
billing_group
source_type
source_id
source_provider
actual_quota
eligible_quota
rebate_bps
rebate_group
status
```

## 前端设计

### 设置页

位置：现有系统设置的“额度设置”。

字段：

1. 邀请实际消耗返利开关。
2. 返利比例百分比输入。
3. 返利到账额度桶选择框。
4. 每日结算时间。

文案建议：

```text
邀请实际消耗返利
当被邀请用户消耗通过兑换码或支付网关购买获得的额度时，系统将在每日结算后按比例返利给邀请人。
```

```text
返利到账额度桶
返利额度将进入所选额度桶。选择 default 表示免费额度桶，选择 VIP 表示 VIP 额度桶。
```

### 用户页

可放在：

- 邀请页面。
- 钱包页面。
- 使用日志页面旁边的“邀请返利”tab。

V1 建议只展示每日结算汇总。

## 幂等和一致性

必须保证：

1. 同一个请求最多产生一条返利事件。
2. 同一个每日结算分组最多发放一次。
3. quota bucket credit 使用唯一 `source/source_id` 防止重复发放。
4. 结算过程在事务内完成。
5. 支付回调重复、任务重试、日志补偿不会重复返利。

推荐唯一约束：

```text
affiliate_usage_rebate_events.request_id unique
affiliate_daily_rebate_settlements(settlement_date, inviter_id, rebate_group, rebate_bps) unique
user_quota_buckets(user_id, source, source_id) 已有唯一索引
```

## 风控和边界

### 自邀请

不允许返利：

```text
inviter_id == invitee_id
```

### 删除用户

被邀请人删除后，历史事件保留 ID。

邀请人删除或禁用：

- V1 可以跳过并标记 failed/skipped。
- 管理员后续可手动处理。

### 退款/拒付

V1 不做退款反扣。

如果后续要做 V2：

- 支付订单退款时记录负向事件。
- 或从邀请人返利桶扣回。
- 如果邀请人已消耗，则记录负余额/待追回。

### 多级邀请

V1 只做一级邀请返利。

### 比例修改

返利事件写入时保存 `rebate_bps` 和 `rebate_group` 快照。

这样管理员改比例后：

- 已产生 pending 事件仍按当时比例结算。
- 新事件按新比例结算。

这是最可审计的方式。

## 推荐落地步骤

### 阶段 1：配置和数据结构

- 新增 setting 常量和 option 加载保存。
- 新增两张表。
- 新增 source 常量：`affiliate_rebate`。
- 前端额度设置增加返利配置。

### 阶段 2：事件记录

- wallet 结算后记录 eligible 消耗。
- subscription 结算后记录 eligible 消耗。
- 增加单测覆盖：
  - 没有邀请人不记录。
  - 返利比例 0 不记录。
  - 免费桶来源不记录。
  - topup/redemption 来源记录。
  - subscription 网关来源记录。
  - wallet/balance/admin subscription 不记录。

### 阶段 3：每日结算

- 新增系统任务。
- 支持自动每日执行。
- 支持管理员手动触发指定日期结算。
- 结算到账支持配置的 `AffiliateUsageRebateGroup`。

### 阶段 4：用户查询

- 用户返利结算列表接口。
- 邀请页/钱包页显示返利明细。
- 结算成功写使用日志。

## 验收用例

### 用例 1：兑换码额度消耗返利到 default

配置：

```text
返利比例 10%
返利桶 default
```

流程：

1. A 邀请 B。
2. B 使用兑换码获得 1000000 额度。
3. B 实际消耗 200000 额度。
4. 每日结算。

期望：

```text
A 获得 default bucket 20000 额度
A 使用日志可见邀请返利到账
重复结算不会重复到账
```

### 用例 2：支付网关充值额度消耗返利到 VIP

配置：

```text
返利比例 20%
返利桶 VIP
```

流程：

1. A 邀请 B。
2. B 通过 Stripe 充值获得 1000000 额度。
3. B 实际消耗 300000 额度。
4. 每日结算。

期望：

```text
A 获得 VIP bucket 60000 额度
不是 default bucket
日志显示到账额度桶 VIP
```

### 用例 3：免费额度不返利

流程：

1. A 邀请 B。
2. B 使用注册赠送额度消耗 100000。
3. 每日结算。

期望：

```text
A 不获得返利
```

### 用例 4：订阅网关购买后消耗返利

流程：

1. A 邀请 B。
2. B 通过 Waffo Pancake 购买订阅。
3. B 消耗订阅额度 500000。
4. 每日结算。

期望：

```text
A 按比例获得返利
```

### 用例 5：余额购买订阅不返利

流程：

1. A 邀请 B。
2. B 用余额或 VIP bucket 购买订阅。
3. B 消耗订阅额度。
4. 每日结算。

期望：

```text
A 不获得返利
```

## 结论

建议 V1 采用：

```text
实际消耗返利 + 每日结算 + 可配置返利比例 + 可配置返利到账桶 + 用户可查询结算日志
```

重点不要把返利桶写死。配置项 `AffiliateUsageRebateGroup` 应和现有分组系统联动，管理员可以选择 `default`、`VIP` 或其它已配置分组。
