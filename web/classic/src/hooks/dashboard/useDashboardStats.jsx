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

import { useMemo } from 'react';
import { Wallet, Activity, Zap, Gauge } from 'lucide-react';
import {
  IconMoneyExchangeStroked,
  IconHistogram,
  IconCoinMoneyStroked,
  IconTextStroked,
  IconPulse,
  IconStopwatchStroked,
  IconTypograph,
  IconSend,
} from '@douyinfe/semi-icons';
import { renderQuota } from '../../helpers';
import { createSectionTitle } from '../../helpers/dashboard';

export const useDashboardStats = (
  userState,
  consumeQuota,
  consumeTokens,
  times,
  trendData,
  performanceMetrics,
  navigate,
  t,
  isAdminUser = false,
  adminOverview = null,
) => {
  const groupedStatsData = useMemo(
    () => {
      const baseGroups = [
        {
          title: createSectionTitle(Wallet, t('账户数据')),
          color: 'bg-blue-50',
          items: [
            {
              title: t('当前余额'),
              value: renderQuota(userState?.user?.quota),
              icon: <IconMoneyExchangeStroked />,
              avatarColor: 'blue',
              trendData: [],
              trendColor: '#3b82f6',
            },
            {
              title: t('历史消耗'),
              value: renderQuota(userState?.user?.used_quota),
              icon: <IconHistogram />,
              avatarColor: 'purple',
              trendData: [],
              trendColor: '#8b5cf6',
            },
          ],
        },
        {
          title: createSectionTitle(Activity, t('使用统计')),
          color: 'bg-green-50',
          items: [
            {
              title: t('请求次数'),
              value: userState.user?.request_count,
              icon: <IconSend />,
              avatarColor: 'green',
              trendData: [],
              trendColor: '#10b981',
            },
            {
              title: t('统计次数'),
              value: times,
              icon: <IconPulse />,
              avatarColor: 'cyan',
              trendData: trendData.times,
              trendColor: '#06b6d4',
            },
          ],
        },
        {
          title: createSectionTitle(Zap, t('资源消耗')),
          color: 'bg-yellow-50',
          items: [
            {
              title: t('统计额度'),
              value: renderQuota(consumeQuota),
              icon: <IconCoinMoneyStroked />,
              avatarColor: 'yellow',
              trendData: trendData.consumeQuota,
              trendColor: '#f59e0b',
            },
            {
              title: t('统计Tokens'),
              value: isNaN(consumeTokens) ? 0 : consumeTokens.toLocaleString(),
              icon: <IconTextStroked />,
              avatarColor: 'pink',
              trendData: trendData.tokens,
              trendColor: '#ec4899',
            },
          ],
        },
        {
          title: createSectionTitle(Gauge, t('性能指标')),
          color: 'bg-indigo-50',
          items: [
            {
              title: t('平均RPM'),
              value: performanceMetrics.avgRPM,
              icon: <IconStopwatchStroked />,
              avatarColor: 'indigo',
              trendData: trendData.rpm,
              trendColor: '#6366f1',
            },
            {
              title: t('平均TPM'),
              value: performanceMetrics.avgTPM,
              icon: <IconTypograph />,
              avatarColor: 'orange',
              trendData: trendData.tpm,
              trendColor: '#f97316',
            },
          ],
        },
      ];

      if (!isAdminUser || !adminOverview) {
        return baseGroups;
      }

      return [
        {
          title: createSectionTitle(Activity, t('全站概览')),
          color: 'bg-emerald-50',
          items: [
            {
              title: t('总用户数'),
              value: adminOverview.total_users ?? 0,
              icon: <IconSend />,
              avatarColor: 'green',
              trendData: [],
              trendColor: '#10b981',
            },
            {
              title: t('活跃用户(7天)'),
              value: adminOverview.active_users_7d ?? 0,
              icon: <IconPulse />,
              avatarColor: 'cyan',
              trendData: [],
              trendColor: '#06b6d4',
            },
          ],
        },
        {
          title: createSectionTitle(Wallet, t('全站资源')),
          color: 'bg-blue-50',
          items: [
            {
              title: t('总剩余额度'),
              value: renderQuota(adminOverview.total_quota ?? 0),
              icon: <IconMoneyExchangeStroked />,
              avatarColor: 'blue',
              trendData: [],
              trendColor: '#3b82f6',
            },
            {
              title: t('总已用额度'),
              value: renderQuota(adminOverview.total_used_quota ?? 0),
              icon: <IconHistogram />,
              avatarColor: 'purple',
              trendData: [],
              trendColor: '#8b5cf6',
            },
          ],
        },
        {
          title: createSectionTitle(Zap, t('全站请求')),
          color: 'bg-yellow-50',
          items: [
            {
              title: t('总请求次数'),
              value: adminOverview.total_request_count ?? 0,
              icon: <IconCoinMoneyStroked />,
              avatarColor: 'yellow',
              trendData: [],
              trendColor: '#f59e0b',
            },
            {
              title: t('新增用户(7天)'),
              value: adminOverview.new_users_7d ?? 0,
              icon: <IconTextStroked />,
              avatarColor: 'pink',
              trendData: [],
              trendColor: '#ec4899',
            },
          ],
        },
        {
          title: createSectionTitle(Gauge, t('管理概况')),
          color: 'bg-indigo-50',
          items: [
            {
              title: t('管理员数量'),
              value: adminOverview.admin_users ?? 0,
              icon: <IconStopwatchStroked />,
              avatarColor: 'indigo',
              trendData: [],
              trendColor: '#6366f1',
            },
            {
              title: t('禁用用户'),
              value: adminOverview.disabled_users ?? 0,
              icon: <IconTypograph />,
              avatarColor: 'orange',
              trendData: [],
              trendColor: '#f97316',
            },
          ],
        },
        ...baseGroups,
      ];
    },
    [
      userState?.user?.quota,
      userState?.user?.used_quota,
      userState?.user?.request_count,
      times,
      consumeQuota,
      consumeTokens,
      trendData,
      performanceMetrics,
      navigate,
      t,
      isAdminUser,
      adminOverview,
    ],
  );

  return {
    groupedStatsData,
  };
};
