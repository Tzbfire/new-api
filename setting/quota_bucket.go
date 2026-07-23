package setting

const DefaultPaidQuotaBillingGroup = "vip"

// QuotaBucketBillingEnabled controls the strict quota-bucket billing mode.
// It is intentionally disabled by default to preserve the legacy users.quota behavior.
var QuotaBucketBillingEnabled = false

// PaidQuotaBillingGroup is the group whose ratio should be used for quota bought
// through top-up or redemption code. The value must match a key in GroupRatio /
// GroupGroupRatio settings.
var PaidQuotaBillingGroup = DefaultPaidQuotaBillingGroup

func GetPaidQuotaBillingGroup() string {
	if PaidQuotaBillingGroup == "" {
		return DefaultPaidQuotaBillingGroup
	}
	return PaidQuotaBillingGroup
}
