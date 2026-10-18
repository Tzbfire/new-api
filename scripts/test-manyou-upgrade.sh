#!/usr/bin/env bash
# Seed a disposable CI database using the fork revision deployed before rc.45.
set -euo pipefail
legacy_checkout="${RUNNER_TEMP:?}/newapi-before-rc45"
git worktree add --detach "$legacy_checkout" 4915bb7fe2b0b0346b8b470221a5352e47784577
trap 'git worktree remove --force "$legacy_checkout"' EXIT
# The old revision redundantly names the task index twice. MySQL cannot
# create that schema from scratch; normalize only that metadata in the fixture.
python3 - "$legacy_checkout/model/image_studio_batch.go" "$legacy_checkout/model/main.go" <<'PYFIX'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
assert 'gorm:"uniqueIndex;index;not null"' in s
p.write_text(s.replace('gorm:"uniqueIndex;index;not null"', 'gorm:"uniqueIndex;not null"'))
# Match the newer revision's quoting of MySQL's reserved option key column.
p = Path(sys.argv[2])
s = p.read_text()
assert s.count('Where("key = ?", markerKey)') == 3
p.write_text(s.replace('Where("key = ?", markerKey)', 'Where(commonKeyCol+" = ?", markerKey)'))
PYFIX
cat > "$legacy_checkout/model/merge_upgrade_fixture_test.go" <<'GO'
package model

import (
    "os"
    "testing"
    "github.com/QuantumNous/new-api/common"
    "github.com/QuantumNous/new-api/setting"
    "github.com/glebarez/sqlite"
    "github.com/stretchr/testify/require"
    "gorm.io/driver/mysql"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

func TestExportMergeUpgradeFixture(t *testing.T) {
    var dialect gorm.Dialector = sqlite.Open(os.Getenv("NEWAPI_TEST_DSN"))
    databaseType := common.DatabaseTypeSQLite
    switch os.Getenv("NEWAPI_TEST_DB") {
    case "mysql": dialect = mysql.Open(os.Getenv("NEWAPI_TEST_DSN")); databaseType = common.DatabaseTypeMySQL
    case "postgres": dialect = postgres.Open(os.Getenv("NEWAPI_TEST_DSN")); databaseType = common.DatabaseTypePostgreSQL
    default:
    }
    common.SetDatabaseTypes(databaseType, databaseType)
    var err error
    DB, err = gorm.Open(dialect, &gorm.Config{})
    require.NoError(t, err)
    LOG_DB = DB
    initCol()
    require.NoError(t, migrateDB())
    setting.QuotaBucketBillingEnabled, setting.PaidQuotaBillingGroup = true, "vip"
    require.NoError(t, DB.Create(&User{Id:9001, Username:"ci-legacy-user", Status:common.UserStatusEnabled, Quota:50}).Error)
    require.NoError(t, CreditUserQuotaBucket(9001, 30, QuotaBucketSourceTopup, "ci-legacy-paid", "vip"))
    _, err = DebitUserQuotaBuckets(9001, 10, QuotaBucketChargeMeta{RequestID:"ci-legacy-debit", BillingGroup:"vip"}, QuotaBucketTxnTypePreConsume)
    require.NoError(t, err)
}
GO
mkdir -p "$legacy_checkout/web/default/dist"
touch "$legacy_checkout/web/default/dist/index.html"
(cd "$legacy_checkout" && GOWORK=off go test ./model -run '^TestExportMergeUpgradeFixture$' -count=1)
