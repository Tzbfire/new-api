/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React from 'react';
import CardPro from '../../common/ui/CardPro';
import UsersTable from './UsersTable';
import UsersActions from './UsersActions';
import UsersFilters from './UsersFilters';
import UsersDescription from './UsersDescription';
import AddUserModal from './modals/AddUserModal';
import EditUserModal from './modals/EditUserModal';
import UsersTabs from './UsersTabs';
import UsersStatsCards from './UsersStatsCards';
import ColumnSelectorModal from './modals/ColumnSelectorModal';
import { useUsersData } from '../../../hooks/users/useUsersData';
import { useIsMobile } from '../../../hooks/common/useIsMobile';
import { createCardProPagination } from '../../../helpers/utils';

const UsersPage = () => {
  const usersData = useUsersData();
  const isMobile = useIsMobile();

  const {
    // Modal state
    showAddUser,
    showEditUser,
    editingUser,
    setShowAddUser,
    closeAddUser,
    closeEditUser,
    refresh,

    // Form state
    formInitValues,
    setFormApi,
    searchUsers,
    loadUsers,
    activePage,
    pageSize,
    groupOptions,
    loading,
    searching,

    // Description state
    compactMode,
    setCompactMode,
    summaryLoading,
    activeTabKey,
    tabCounts,
    handleTabChange,
    showColumnSelector,
    setShowColumnSelector,
    visibleColumns,
    handleColumnVisibilityChange,
    handleSelectAllColumns,
    initDefaultColumns,
    USER_COLUMN_KEYS,

    // Translation
    t,
  } = usersData;

  return (
    <>
      <AddUserModal
        refresh={refresh}
        visible={showAddUser}
        handleClose={closeAddUser}
      />

      <EditUserModal
        refresh={refresh}
        visible={showEditUser}
        handleClose={closeEditUser}
        editingUser={editingUser}
      />

      <ColumnSelectorModal
        showColumnSelector={showColumnSelector}
        setShowColumnSelector={setShowColumnSelector}
        visibleColumns={visibleColumns}
        handleColumnVisibilityChange={handleColumnVisibilityChange}
        handleSelectAllColumns={handleSelectAllColumns}
        initDefaultColumns={initDefaultColumns}
        USER_COLUMN_KEYS={USER_COLUMN_KEYS}
        t={t}
      />

      <CardPro
        type='type3'
        statsArea={
          <UsersStatsCards
            summary={usersData.globalSummary}
            loading={summaryLoading}
            t={t}
          />
        }
        descriptionArea={
          <UsersDescription
            compactMode={compactMode}
            setCompactMode={setCompactMode}
            t={t}
          />
        }
        tabsArea={
          <UsersTabs
            activeTabKey={activeTabKey}
            handleTabChange={handleTabChange}
            tabCounts={tabCounts}
            t={t}
          />
        }
        actionsArea={
          <UsersActions
            setShowAddUser={setShowAddUser}
            selectedUsers={usersData.selectedUsers}
            batchDisableUsers={usersData.batchDisableUsers}
            batchEnableUsers={usersData.batchEnableUsers}
            setShowColumnSelector={setShowColumnSelector}
            loading={usersData.loading}
            t={t}
          />
        }
        searchArea={
          <UsersFilters
            formInitValues={formInitValues}
            setFormApi={setFormApi}
            searchUsers={usersData.searchCurrentUsers}
            loadUsers={usersData.loadCurrentUsers}
            pageSize={pageSize}
            groupOptions={groupOptions}
            loading={loading}
            searching={searching}
            t={t}
          />
        }
        paginationArea={createCardProPagination({
          currentPage: usersData.activePage,
          pageSize: usersData.pageSize,
          total: usersData.userCount,
          onPageChange: usersData.handlePageChange,
          onPageSizeChange: usersData.handlePageSizeChange,
          isMobile: isMobile,
          t: usersData.t,
        })}
        t={usersData.t}
      >
        <UsersTable {...usersData} />
      </CardPro>
    </>
  );
};

export default UsersPage;
