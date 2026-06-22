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

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../helpers';
import { ITEMS_PER_PAGE } from '../../constants';
import { useTableCompactMode } from '../common/useTableCompactMode';

export const useUsersData = () => {
  const { t } = useTranslation();
  const [compactMode, setCompactMode] = useTableCompactMode('users');

  const USER_TAB_KEYS = {
    ALL: 'all',
    ENABLED: 'enabled',
    DISABLED: 'disabled',
    DELETED: 'deleted',
    ADMIN: 'admin',
    SUBSCRIBED: 'subscribed',
    ACTIVE_7D: 'active_7d',
  };

  const USER_COLUMN_KEYS = {
    ID: 'id',
    USERNAME: 'username',
    STATUS: 'status',
    QUOTA_USAGE: 'quota_usage',
    GROUP: 'group',
    ROLE: 'role',
    CREATED_AT: 'created_at',
    LAST_LOGIN_AT: 'last_login_at',
    LAST_REQUEST_AT: 'last_request_at',
    REQUEST_COUNT: 'request_count',
    SUBSCRIPTION: 'subscription',
    SECURITY: 'security',
    INVITE: 'invite',
    OPERATE: 'operate',
  };

  const getDefaultColumnVisibility = () => ({
    [USER_COLUMN_KEYS.ID]: true,
    [USER_COLUMN_KEYS.USERNAME]: true,
    [USER_COLUMN_KEYS.STATUS]: true,
    [USER_COLUMN_KEYS.QUOTA_USAGE]: true,
    [USER_COLUMN_KEYS.GROUP]: true,
    [USER_COLUMN_KEYS.ROLE]: true,
    [USER_COLUMN_KEYS.CREATED_AT]: true,
    [USER_COLUMN_KEYS.LAST_LOGIN_AT]: false,
    [USER_COLUMN_KEYS.LAST_REQUEST_AT]: true,
    [USER_COLUMN_KEYS.REQUEST_COUNT]: false,
    [USER_COLUMN_KEYS.SUBSCRIPTION]: true,
    [USER_COLUMN_KEYS.SECURITY]: true,
    [USER_COLUMN_KEYS.INVITE]: false,
    [USER_COLUMN_KEYS.OPERATE]: true,
  });

  const getSummaryFallback = () => ({
    total: 0,
    active_count: 0,
    disabled_count: 0,
    deleted_count: 0,
    admin_count: 0,
    subscribed_count: 0,
    recently_active_count: 0,
  });

  const buildTabFilters = (tabKey) => {
    switch (tabKey) {
      case USER_TAB_KEYS.ENABLED:
        return { status: 1 };
      case USER_TAB_KEYS.DISABLED:
        return { status: 2 };
      case USER_TAB_KEYS.DELETED:
        return { deleted_only: true };
      case USER_TAB_KEYS.ADMIN:
        return { min_role: 10 };
      case USER_TAB_KEYS.SUBSCRIBED:
        return { has_subscription: true };
      case USER_TAB_KEYS.ACTIVE_7D:
        return { active_within_days: 7 };
      default:
        return {};
    }
  };

  // State management
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
  const [searching, setSearching] = useState(false);
  const [groupOptions, setGroupOptions] = useState([]);
  const [userCount, setUserCount] = useState(0);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [summary, setSummary] = useState(getSummaryFallback());
  const [globalSummary, setGlobalSummary] = useState(getSummaryFallback());
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState(USER_TAB_KEYS.ALL);
  const [visibleColumns, setVisibleColumns] = useState({});
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Modal states
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUser, setEditingUser] = useState({
    id: undefined,
  });

  // Form initial values
  const formInitValues = {
    searchKeyword: '',
    searchGroup: '',
    searchRole: '',
    searchStatus: '',
    searchHasSubscription: '',
    searchActiveWithinDays: '',
    searchQuotaHealth: '',
  };

  // Form API reference
  const [formApi, setFormApi] = useState(null);

  // Get form values helper function
  const getFormValues = () => {
    const formValues = formApi ? formApi.getValues() : {};
    return {
      searchKeyword: formValues.searchKeyword || '',
      searchGroup: formValues.searchGroup || '',
      searchRole: formValues.searchRole === undefined ? '' : formValues.searchRole,
      searchStatus: formValues.searchStatus === undefined ? '' : formValues.searchStatus,
      searchHasSubscription:
        formValues.searchHasSubscription === undefined
          ? ''
          : formValues.searchHasSubscription,
      searchActiveWithinDays:
        formValues.searchActiveWithinDays === undefined
          ? ''
          : formValues.searchActiveWithinDays,
      searchQuotaHealth: formValues.searchQuotaHealth || '',
    };
  };

  const buildSearchParams = (overrides = {}, tabKey = activeTabKey) => {
    const formValues = getFormValues();
    const merged = {
      ...formValues,
      ...overrides,
    };
    const params = new URLSearchParams();

    if (merged.searchKeyword !== '') {
      params.set('keyword', merged.searchKeyword);
    }
    if (merged.searchGroup !== '') {
      params.set('group', merged.searchGroup);
    }
    if (merged.searchRole !== '') {
      params.set('role', merged.searchRole);
    }
    if (merged.searchStatus !== '') {
      params.set('status', merged.searchStatus);
    }
    if (merged.searchHasSubscription !== '') {
      params.set('has_subscription', merged.searchHasSubscription);
    }
    if (merged.searchActiveWithinDays !== '') {
      params.set('active_within_days', merged.searchActiveWithinDays);
    }
    if (merged.searchQuotaHealth !== '') {
      params.set('quota_health', merged.searchQuotaHealth);
    }

    const tabFilters = buildTabFilters(tabKey);
    Object.entries(tabFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    });

    return params;
  };

  // Set user format with key field
  const setUserFormat = (users) => {
    for (let i = 0; i < users.length; i++) {
      users[i].key = users[i].id;
    }
    setUsers(users);
  };

  const clearSelection = () => {
    setSelectedUsers([]);
  };

  const rowSelection = {
    selectedRowKeys: selectedUsers.map((user) => user.id),
    onChange: (_, selectedRows) => {
      setSelectedUsers(selectedRows);
    },
  };

  // Load users data
  const loadUsers = async (page, pageSize, options = {}) => {
    setLoading(true);
    const params = buildSearchParams(options.overrides, options.tabKey);
    params.set('p', page);
    params.set('page_size', pageSize);
    const res = await API.get(`/api/user/?${params.toString()}`);
    const { success, message, data } = res.data;
    if (success) {
      clearSelection();
      const newPageData = data.items;
      setActivePage(data.page);
      setUserCount(data.total);
      setUserFormat(newPageData);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const loadCurrentUsers = async (
    page,
    nextPageSize = pageSize,
    options = {},
  ) => {
    await loadUsers(page, nextPageSize, {
      tabKey: options.tabKey ?? activeTabKey,
      overrides: options.overrides,
    });
  };

  // Search users with keyword and group
  const searchUsers = async (
    page,
    pageSize,
    overrides = {},
    options = {},
  ) => {
    const params = buildSearchParams(overrides, options.tabKey);
    setSearching(true);
    params.set('p', page);
    params.set('page_size', pageSize);
    const res = await API.get(`/api/user/search?${params.toString()}`);
    const { success, message, data } = res.data;
    if (success) {
      clearSelection();
      const newPageData = data.items;
      setActivePage(data.page);
      setUserCount(data.total);
      setUserFormat(newPageData);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  const searchCurrentUsers = async (
    page,
    nextPageSize = pageSize,
    overrides = {},
    options = {},
  ) => {
    await searchUsers(page, nextPageSize, overrides, {
      ...options,
      tabKey: options.tabKey ?? activeTabKey,
    });
  };

  const fetchSummary = async (
    overrides = {},
    tabKey = activeTabKey,
    options = {},
  ) => {
    setSummaryLoading(true);
    try {
      const params = buildSearchParams(overrides, tabKey);
      const res = await API.get(`/api/user/summary?${params.toString()}`);
      const { success, message, data } = res.data;
      if (success) {
        const nextSummary = { ...getSummaryFallback(), ...(data || {}) };
        setSummary(nextSummary);
        if (options.global) {
          setGlobalSummary(nextSummary);
        }
      } else {
        showError(message || t('加载用户概览失败'));
      }
    } catch (error) {
      showError(t('加载用户概览失败'));
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleTabChange = async (tabKey) => {
    clearSelection();
    setActiveTabKey(tabKey);
    setActivePage(1);
    await loadUsers(1, pageSize, { tabKey });
    await fetchSummary({}, tabKey).catch(() => {});
  };

  const initDefaultColumns = () => {
    setVisibleColumns(getDefaultColumnVisibility());
  };

  const handleColumnVisibilityChange = (columnKey, checked) => {
    setVisibleColumns((prev) => ({ ...prev, [columnKey]: checked }));
  };

  const handleSelectAllColumns = (checked) => {
    const updatedColumns = {};
    Object.values(USER_COLUMN_KEYS).forEach((key) => {
      updatedColumns[key] = checked;
    });
    setVisibleColumns(updatedColumns);
  };

  const tabCounts = useMemo(
    () => ({
      [USER_TAB_KEYS.ALL]: globalSummary.total || 0,
      [USER_TAB_KEYS.ENABLED]: globalSummary.active_count || 0,
      [USER_TAB_KEYS.DISABLED]: globalSummary.disabled_count || 0,
      [USER_TAB_KEYS.DELETED]: globalSummary.deleted_count || 0,
      [USER_TAB_KEYS.ADMIN]: globalSummary.admin_count || 0,
      [USER_TAB_KEYS.SUBSCRIBED]: globalSummary.subscribed_count || 0,
      [USER_TAB_KEYS.ACTIVE_7D]: globalSummary.recently_active_count || 0,
    }),
    [globalSummary],
  );

  const manageUser = async (userId, action, record) => {
    // Trigger loading state to force table re-render
    setLoading(true);

    const res = await API.post('/api/user/manage', {
      id: userId,
      action,
    });

    const { success, message } = res.data;
    if (success) {
      showSuccess(t('操作成功完成！'));
      clearSelection();
      const user = res.data.data;

      // Create a new array and new object to ensure React detects changes
      const newUsers = users.map((u) => {
        if (u.id === userId) {
          if (action === 'delete') {
            return { ...u, DeletedAt: new Date() };
          }
          return { ...u, status: user.status, role: user.role };
        }
        return u;
      });

      setUsers(newUsers);
    } else {
      showError(message);
    }

    setLoading(false);
  };

  const resetUserPasskey = async (user) => {
    if (!user) {
      return;
    }
    try {
      const res = await API.delete(`/api/user/${user.id}/reset_passkey`);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('Passkey 已重置'));
      } else {
        showError(message || t('操作失败，请重试'));
      }
    } catch (error) {
      showError(t('操作失败，请重试'));
    }
  };

  const resetUserTwoFA = async (user) => {
    if (!user) {
      return;
    }
    try {
      const res = await API.delete(`/api/user/${user.id}/2fa`);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('二步验证已重置'));
      } else {
        showError(message || t('操作失败，请重试'));
      }
    } catch (error) {
      showError(t('操作失败，请重试'));
    }
  };

  const batchManageUsers = async (action) => {
    const ids = selectedUsers.map((user) => user.id).filter(Boolean);
    if (ids.length === 0) {
      return;
    }

    const actionMeta =
      action === 'enable'
        ? {
            title: t('确认批量启用'),
            content: t('确认启用所选用户？若包含不可操作用户，系统会自动跳过。'),
            success: t('批量启用完成，已启用 {{count}} 个用户。', {
              count: '{{count}}',
            }),
            partialSuccess: t('批量启用完成，已启用 {{count}} 个用户，跳过 {{skipped}} 个用户。', {
              count: '{{count}}',
              skipped: '{{skipped}}',
            }),
            empty: t('没有可启用的用户'),
            nextStatus: 1,
          }
        : {
            title: t('确认批量禁用'),
            content: t('确认禁用所选用户？若包含不可操作用户，系统会自动跳过。'),
            success: t('批量禁用完成，已禁用 {{count}} 个用户。', {
              count: '{{count}}',
            }),
            partialSuccess: t('批量禁用完成，已禁用 {{count}} 个用户，跳过 {{skipped}} 个用户。', {
              count: '{{count}}',
              skipped: '{{skipped}}',
            }),
            empty: t('没有可禁用的用户'),
            nextStatus: 2,
          };

    Modal.confirm({
      title: actionMeta.title,
      content: actionMeta.content,
      okType: action === 'disable' ? 'danger' : 'primary',
      onOk: async () => {
        setLoading(true);
        try {
          const res = await API.post('/api/user/manage_batch', {
            ids,
            action,
          });
          const { success, message, data } = res.data;
          if (!success) {
            showError(message || t('操作失败，请重试'));
            return;
          }

          const updatedIds = Array.isArray(data?.updated_ids) ? data.updated_ids : [];
          const skippedIds = Array.isArray(data?.skipped_ids) ? data.skipped_ids : [];

          if (updatedIds.length > 0) {
            setUsers((prevUsers) =>
              prevUsers.map((user) =>
                updatedIds.includes(user.id)
                  ? { ...user, status: actionMeta.nextStatus }
                  : user,
              ),
            );
          }

          clearSelection();
          fetchSummary().catch(() => {});

          if (updatedIds.length > 0 && skippedIds.length > 0) {
            showSuccess(
              t(
                action === 'enable'
                  ? '批量启用完成，已启用 {{count}} 个用户，跳过 {{skipped}} 个用户。'
                  : '批量禁用完成，已禁用 {{count}} 个用户，跳过 {{skipped}} 个用户。',
                {
                  count: updatedIds.length,
                  skipped: skippedIds.length,
                },
              ),
            );
          } else if (updatedIds.length > 0) {
            showSuccess(
              t(
                action === 'enable'
                  ? '批量启用完成，已启用 {{count}} 个用户。'
                  : '批量禁用完成，已禁用 {{count}} 个用户。',
                {
                  count: updatedIds.length,
                },
              ),
            );
          } else {
            showError(actionMeta.empty);
          }
        } catch (error) {
          showError(t('操作失败，请重试'));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const batchDisableUsers = async () => {
    await batchManageUsers('disable');
  };

  const batchEnableUsers = async () => {
    await batchManageUsers('enable');
  };

  // Handle page change
  const handlePageChange = (page) => {
    clearSelection();
    setActivePage(page);
    loadCurrentUsers(page).then();
  };

  // Handle page size change
  const handlePageSizeChange = async (size) => {
    clearSelection();
    localStorage.setItem('page-size', size + '');
    setPageSize(size);
    setActivePage(1);
    loadCurrentUsers(1, size)
      .then()
      .catch((reason) => {
        showError(reason);
      });
  };

  // Handle table row styling for disabled/deleted users
  const handleRow = (record, index) => {
    if (record.DeletedAt !== null || record.status !== 1) {
      return {
        style: {
          background: 'var(--semi-color-disabled-border)',
        },
      };
    } else {
      return {};
    }
  };

  // Refresh data
  const refresh = async (page = activePage) => {
    clearSelection();
    await loadCurrentUsers(page);
  };

  // Fetch groups data
  const fetchGroups = async () => {
    try {
      let res = await API.get(`/api/group/`);
      if (res === undefined) {
        return;
      }
      setGroupOptions(
        res.data.data.map((group) => ({
          label: group,
          value: group,
        })),
      );
    } catch (error) {
      showError(error.message);
    }
  };

  // Modal control functions
  const closeAddUser = () => {
    setShowAddUser(false);
  };

  const closeEditUser = () => {
    setShowEditUser(false);
    setEditingUser({
      id: undefined,
    });
  };

  useEffect(() => {
    const localPageSize = parseInt(localStorage.getItem('page-size')) || ITEMS_PER_PAGE;
    setPageSize(localPageSize);

    const savedColumns = localStorage.getItem('users-table-columns');
    if (savedColumns) {
      try {
        const parsed = JSON.parse(savedColumns);
        setVisibleColumns({ ...getDefaultColumnVisibility(), ...parsed });
      } catch (error) {
        initDefaultColumns();
      }
    } else {
      initDefaultColumns();
    }

    loadCurrentUsers(1, localPageSize)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    fetchGroups().then();
    fetchSummary({}, USER_TAB_KEYS.ALL, { global: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (Object.keys(visibleColumns).length > 0) {
      localStorage.setItem('users-table-columns', JSON.stringify(visibleColumns));
    }
  }, [visibleColumns]);

  useEffect(() => {
    if (!formApi) {
      return;
    }
    fetchSummary({}, USER_TAB_KEYS.ALL, { global: true }).catch(() => {});
  }, [formApi]);

  useEffect(() => {
    if (!formApi) {
      return;
    }
    fetchSummary({}, activeTabKey).catch(() => {});
  }, [activeTabKey, formApi]);

  return {
    // Data state
    users,
    loading,
    activePage,
    pageSize,
    userCount,
    searching,
    groupOptions,
    selectedUsers,
    rowSelection,

    // Modal state
    showAddUser,
    showEditUser,
    editingUser,
    setShowAddUser,
    setShowEditUser,
    setEditingUser,

    // Form state
    formInitValues,
    formApi,
    setFormApi,

    // UI state
    compactMode,
    setCompactMode,
    summary,
    globalSummary,
    summaryLoading,
    activeTabKey,
    setActiveTabKey,
    tabCounts,
    visibleColumns,
    showColumnSelector,
    setShowColumnSelector,
    USER_TAB_KEYS,
    USER_COLUMN_KEYS,
    handleTabChange,
    handleColumnVisibilityChange,
    handleSelectAllColumns,
    initDefaultColumns,

    // Actions
    loadUsers,
    loadCurrentUsers,
    searchUsers,
    searchCurrentUsers,
    manageUser,
    resetUserPasskey,
    resetUserTwoFA,
    batchDisableUsers,
    batchEnableUsers,
    clearSelection,
    handlePageChange,
    handlePageSizeChange,
    handleRow,
    refresh,
    closeAddUser,
    closeEditUser,
    getFormValues,

    // Translation
    t,
  };
};
