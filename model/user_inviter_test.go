package model

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUserInsertPersistsInviterWithoutRewards(t *testing.T) {
	previousNewUserQuota := common.QuotaForNewUser
	previousInviteeQuota := common.QuotaForInvitee
	previousInviterQuota := common.QuotaForInviter
	previousCompliance := operation_setting.GetPaymentSetting().ComplianceConfirmed
	t.Cleanup(func() {
		common.QuotaForNewUser = previousNewUserQuota
		common.QuotaForInvitee = previousInviteeQuota
		common.QuotaForInviter = previousInviterQuota
		operation_setting.GetPaymentSetting().ComplianceConfirmed = previousCompliance
	})
	common.QuotaForNewUser = 0
	common.QuotaForInvitee = 0
	common.QuotaForInviter = 0
	operation_setting.GetPaymentSetting().ComplianceConfirmed = false

	for _, tc := range []struct {
		name          string
		transactional bool
		invited       bool
	}{
		{name: "ordinary registration with inviter", invited: true},
		{name: "ordinary registration without inviter"},
		{name: "transactional registration with inviter", transactional: true, invited: true},
		{name: "transactional registration without inviter", transactional: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupUserUpdateTestState(t)
			inviter := User{Username: "inviter", AffCode: "test-invite", Status: common.UserStatusEnabled}
			require.NoError(t, DB.Create(&inviter).Error)
			inviterID := 0
			if tc.invited {
				inviterID = inviter.Id
			}
			user := User{Username: "invitee", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			if tc.transactional {
				require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
					return user.InsertWithTx(tx, inviterID)
				}))
				user.FinalizeOAuthUserCreation(inviterID)
			} else {
				require.NoError(t, user.Insert(inviterID))
			}

			var stored User
			require.NoError(t, DB.First(&stored, user.Id).Error)
			assert.Equal(t, inviterID, stored.InviterId)
			assert.Equal(t, inviterID, user.InviterId)
			assert.Zero(t, stored.Quota)
			require.NoError(t, DB.First(&inviter, inviter.Id).Error)
			assert.Zero(t, inviter.AffCount)
			assert.Zero(t, inviter.AffQuota)
		})
	}
}

func TestUserInviterRegistrationRollsBackWithTransaction(t *testing.T) {
	setupUserUpdateTestState(t)
	inviter := User{Username: "inviter", AffCode: "test-invite", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(&inviter).Error)
	user := User{Username: "invitee", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	bindingError := errors.New("OAuth binding failed")
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := user.InsertWithTx(tx, inviter.Id); err != nil {
			return err
		}
		var stored User
		require.NoError(t, tx.First(&stored, user.Id).Error)
		assert.Equal(t, inviter.Id, stored.InviterId)
		return bindingError
	})
	require.ErrorIs(t, err, bindingError)
	var count int64
	require.NoError(t, DB.Model(&User{}).Where("username = ?", user.Username).Count(&count).Error)
	assert.Zero(t, count)
}
