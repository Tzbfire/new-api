package frontend_setting

import (
	"os"
	"path/filepath"

	"github.com/QuantumNous/new-api/setting/config"
)

type FrontendSetting struct {
	Enabled bool `json:"enabled"`
}

var frontendSetting = FrontendSetting{Enabled: true}

func init() { config.GlobalConfig.Register("frontend_setting", &frontendSetting) }

func GetFrontendSetting() *FrontendSetting { return &frontendSetting }

// Available reports whether the independently deployed consumer build is ready.
func Available() bool {
	dir := os.Getenv("CONSUMER_FRONTEND_DIR")
	if dir == "" {
		return false
	}
	file, err := os.Open(filepath.Join(dir, "index.html"))
	if err != nil {
		return false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return false
	}
	var first [1]byte
	_, err = file.Read(first[:])
	return err == nil
}
