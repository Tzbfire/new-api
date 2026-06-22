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
import { Tabs, TabPane, Tag } from '@douyinfe/semi-ui';

const UsersTabs = ({ activeTabKey, handleTabChange, tabCounts, t }) => {
  const tabItems = [
    { key: 'all', label: t('全部') },
    { key: 'enabled', label: t('已启用') },
    { key: 'disabled', label: t('已禁用') },
    { key: 'deleted', label: t('已注销') },
    { key: 'admin', label: t('管理员') },
    { key: 'subscribed', label: t('有订阅') },
    { key: 'active_7d', label: t('近 7 天活跃') },
  ];

  return (
    <div className='mb-2 flex flex-wrap gap-2'>
      {tabItems.map((item) => {
        const isActive = activeTabKey === item.key;
        return (
          <button
            key={item.key}
            type='button'
            data-user-tab={item.key}
            onClick={() => handleTabChange(item.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
              isActive
                ? 'border-[var(--semi-color-primary)] bg-[var(--semi-color-primary-light-default)] text-[var(--semi-color-primary)]'
                : 'border-[var(--semi-color-border)] bg-[var(--semi-color-bg-1)] text-[var(--semi-color-text-0)] hover:border-[var(--semi-color-primary)]'
            }`}
          >
            <span>{item.label}</span>
            <Tag color={isActive ? 'red' : 'grey'} shape='circle'>
              {tabCounts[item.key] || 0}
            </Tag>
          </button>
        );
      })}
    </div>
  );
};

export default UsersTabs;
