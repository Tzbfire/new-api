#!/usr/bin/env bash
# Seed a disposable CI database using the previous deployed-compatible main.
set -euo pipefail
legacy_checkout="${RUNNER_TEMP:?}/newapi-before-manyou-20261030"
git worktree add --detach "$legacy_checkout" 1407c583acd9d75fe8b7a44cfb73b344d11224ca
trap 'git worktree remove --force "$legacy_checkout"' EXIT
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
mkdir -p "$legacy_checkout/web/dist"
touch "$legacy_checkout/web/dist/index.html"
(cd "$legacy_checkout" && GOWORK=off go test ./model -run '^TestExportMergeUpgradeFixture$' -count=1)
