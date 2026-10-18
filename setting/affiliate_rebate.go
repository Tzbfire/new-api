package setting

const DefaultAffiliateUsageRebateGroup = "default"

var AffiliateUsageRebateEnabled = false
var AffiliateUsageRebateBps = 0
var AffiliateUsageRebateGroup = DefaultAffiliateUsageRebateGroup
var AffiliateUsageRebateHour = 0

func GetAffiliateUsageRebateGroup() string {
	if AffiliateUsageRebateGroup == "" {
		return DefaultAffiliateUsageRebateGroup
	}
	return AffiliateUsageRebateGroup
}
