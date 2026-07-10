package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUpdateOptionDoesNotHotApplyAfterDatabaseFailure(t *testing.T) {
	previous := DB
	database, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Option{}))
	sqlDatabase, err := database.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDatabase.Close())
	DB = database
	t.Cleanup(func() { DB = previous })

	require.Error(t, UpdateOption("ImageStudioBatchConcurrency", "4"))
}
