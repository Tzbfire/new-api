package setting

import (
	"errors"
	"maps"
	"slices"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const GroupDisplayOrderOptionKey = "group_setting.display_order"

// Display order is presentation-only. AutoGroups retains its separate routing
// priority, and callers must supply only groups already visible to the user.
var groupDisplaySetting = struct {
	DisplayOrder []string `json:"display_order"`
}{DisplayOrder: []string{}}

func init() {
	config.GlobalConfig.Register("group_setting", &groupDisplaySetting)
}

func ValidateGroupDisplayOrder(value string) error {
	var groups []string
	if err := common.UnmarshalJsonStr(value, &groups); err != nil || groups == nil {
		return errors.New("group display order must be a JSON array of unique group names")
	}
	seen := make(map[string]struct{}, len(groups))
	for _, name := range groups {
		if name == "" || strings.TrimSpace(name) != name || strings.ContainsFunc(name, unicode.IsControl) {
			return errors.New("group display order contains an invalid group name")
		}
		if _, exists := seen[name]; exists {
			return errors.New("group display order contains a duplicate group name")
		}
		seen[name] = struct{}{}
	}
	return nil
}

// OrderGroupNames ignores deleted configuration entries and appends newly
// created groups alphabetically. It never introduces a group absent from names.
func OrderGroupNames(names []string) []string {
	common.OptionMapRWMutex.RLock()
	configured := slices.Clone(groupDisplaySetting.DisplayOrder)
	common.OptionMapRWMutex.RUnlock()

	remaining := make(map[string]struct{}, len(names))
	for _, name := range names {
		remaining[name] = struct{}{}
	}
	ordered := make([]string, 0, len(remaining))
	for _, name := range configured {
		if _, exists := remaining[name]; exists {
			ordered = append(ordered, name)
			delete(remaining, name)
		}
	}
	return append(ordered, slices.Sorted(maps.Keys(remaining))...)
}
