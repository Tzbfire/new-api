package setting

import (
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// maxRateLimitDurationSeconds is the largest window the count cap is computed
// against (24h). Token-bucket capacity is count*duration; this keeps that
// product inside int64 when the window is at most a day.
const maxRateLimitDurationSeconds = 24 * 60 * 60

// maxModelRequestRateLimitCount is math.MaxInt64 / maxRateLimitDurationSeconds.
// It is the largest count that cannot overflow int64(count)*duration for a
// window of at most 24 hours.
const maxModelRequestRateLimitCount int64 = math.MaxInt64 / maxRateLimitDurationSeconds

var ModelRequestRateLimitEnabled = false
var ModelRequestRateLimitDurationMinutes = 1
var ModelRequestRateLimitCount = 0
var ModelRequestRateLimitSuccessCount = 1000
var ModelRequestRateLimitGroup = map[string][2]int{}
var ModelRequestRateLimitModel = map[string][2]int{}
var ModelRequestRateLimitGroupModel = map[string]map[string][2]int{}
var ModelRequestRateLimitMutex sync.RWMutex

func ModelRequestRateLimitGroup2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitGroup)
	if err != nil {
		common.SysLog(common.LogText("error marshalling model ratio: %s", err.Error()))
	}
	return string(jsonBytes)
}

func UpdateModelRequestRateLimitGroupByJSONString(jsonStr string) error {
	ModelRequestRateLimitMutex.Lock()
	defer ModelRequestRateLimitMutex.Unlock()

	groupLimits := make(map[string][2]int)
	if err := common.Unmarshal([]byte(jsonStr), &groupLimits); err != nil {
		return err
	}
	ModelRequestRateLimitGroup = groupLimits
	return nil
}

func GetGroupRateLimit(group string) (totalCount, successCount int, found bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	if ModelRequestRateLimitGroup == nil {
		return 0, 0, false
	}

	limits, found := ModelRequestRateLimitGroup[group]
	if !found {
		return 0, 0, false
	}
	return limits[0], limits[1], true
}

func ModelRequestRateLimitModel2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitModel)
	if err != nil {
		common.SysLog(common.LogText("error marshalling model rate limits: %s", err.Error()))
	}
	return string(jsonBytes)
}

func UpdateModelRequestRateLimitModelByJSONString(jsonStr string) error {
	modelLimits := make(map[string][2]int)
	if err := common.Unmarshal([]byte(jsonStr), &modelLimits); err != nil {
		return err
	}

	ModelRequestRateLimitMutex.Lock()
	defer ModelRequestRateLimitMutex.Unlock()
	ModelRequestRateLimitModel = modelLimits
	return nil
}

func GetModelRateLimit(model string) (totalCount, successCount int, found bool) {
	model = strings.TrimSpace(model)
	if model == "" {
		return 0, 0, false
	}

	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	limits, found := ModelRequestRateLimitModel[model]
	if !found {
		return 0, 0, false
	}
	return limits[0], limits[1], true
}

func ModelRequestRateLimitGroupModel2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitGroupModel)
	if err != nil {
		common.SysLog(common.LogText("error marshalling model rate limits: %s", err.Error()))
	}
	return string(jsonBytes)
}

func parseGroupModelRateLimits(jsonStr string) (map[string]map[string][2]int, error) {
	var input map[string]map[string][]*int
	if err := common.UnmarshalJsonStr(jsonStr, &input); err != nil {
		return nil, err
	}
	if input == nil {
		return nil, fmt.Errorf("group model rate limits must be an object")
	}

	groupModels := make(map[string]map[string][2]int, len(input))
	for group, models := range input {
		if group == "" || group != strings.TrimSpace(group) {
			return nil, fmt.Errorf("group name cannot be empty or contain surrounding whitespace")
		}
		if models == nil {
			return nil, fmt.Errorf("group %s model rate limits must be an object", group)
		}
		groupModels[group] = make(map[string][2]int, len(models))
		for model, values := range models {
			if model == "" || model != strings.TrimSpace(model) {
				return nil, fmt.Errorf("model name cannot be empty or contain surrounding whitespace")
			}
			if len(values) != 2 || values[0] == nil || values[1] == nil {
				return nil, fmt.Errorf("group %s model %s rate limit must contain exactly two integers", group, model)
			}
			limits := [2]int{*values[0], *values[1]}
			if limits[0] < 0 || limits[1] < 0 {
				return nil, fmt.Errorf("group %s model %s has negative rate limit values: [%d, %d]", group, model, limits[0], limits[1])
			}
			if int64(limits[0]) > maxModelRequestRateLimitCount || int64(limits[1]) > maxModelRequestRateLimitCount {
				return nil, fmt.Errorf("group %s model %s [%d, %d] exceeds max rate limit %d", group, model, limits[0], limits[1], maxModelRequestRateLimitCount)
			}
			groupModels[group][model] = limits
		}
	}
	return groupModels, nil
}

func CheckModelRequestRateLimitGroupModel(jsonStr string) error {
	_, err := parseGroupModelRateLimits(jsonStr)
	return err
}

func UpdateModelRequestRateLimitGroupModelByJSONString(jsonStr string) error {
	groupModels, err := parseGroupModelRateLimits(jsonStr)
	if err != nil {
		return err
	}
	ModelRequestRateLimitMutex.Lock()
	defer ModelRequestRateLimitMutex.Unlock()
	ModelRequestRateLimitGroupModel = groupModels
	return nil
}

func GetGroupModelRateLimit(group, model string) (totalCount, successCount int, found bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	limits, found := ModelRequestRateLimitGroupModel[group][model]
	return limits[0], limits[1], found
}

func CheckModelRequestRateLimitGroup(jsonStr string) error {
	checkModelRequestRateLimitGroup := make(map[string][2]int)
	err := common.Unmarshal([]byte(jsonStr), &checkModelRequestRateLimitGroup)
	if err != nil {
		return err
	}
	for group, limits := range checkModelRequestRateLimitGroup {
		if limits[0] < 0 || limits[1] < 1 {
			return fmt.Errorf("group %s has negative rate limit values: [%d, %d]", group, limits[0], limits[1])
		}
		if int64(limits[0]) > maxModelRequestRateLimitCount || int64(limits[1]) > maxModelRequestRateLimitCount {
			return fmt.Errorf("group %s [%d, %d] exceeds max rate limit %d", group, limits[0], limits[1], maxModelRequestRateLimitCount)
		}
	}

	return nil
}

func CheckModelRequestRateLimitModel(jsonStr string) error {
	checkModelRequestRateLimitModel := make(map[string][2]int)
	if err := common.Unmarshal([]byte(jsonStr), &checkModelRequestRateLimitModel); err != nil {
		return err
	}

	for model, limits := range checkModelRequestRateLimitModel {
		if strings.TrimSpace(model) == "" {
			return fmt.Errorf("model name cannot be empty")
		}
		if limits[0] < 0 || limits[1] < 1 {
			return fmt.Errorf("model %s has negative rate limit values: [%d, %d]", model, limits[0], limits[1])
		}
		if int64(limits[0]) > maxModelRequestRateLimitCount || int64(limits[1]) > maxModelRequestRateLimitCount {
			return fmt.Errorf("model %s [%d, %d] exceeds max rate limit %d", model, limits[0], limits[1], maxModelRequestRateLimitCount)
		}
	}

	return nil
}
