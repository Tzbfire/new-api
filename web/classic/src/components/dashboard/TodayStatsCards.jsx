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
import { Card, Skeleton, Typography } from '@douyinfe/semi-ui';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderNumber, renderQuota } from '../../helpers';

const { Text } = Typography;

const computeDelta = (current, previous) => {
  if (!previous || previous === 0) {
    if (!current || current === 0) return { sign: 0, percent: 0 };
    return { sign: 1, percent: null };
  }
  const diff = current - previous;
  const percent = (diff / previous) * 100;
  return {
    sign: diff === 0 ? 0 : diff > 0 ? 1 : -1,
    percent: Math.abs(percent),
  };
};

const DeltaTag = ({ sign, percent, t }) => {
  const color =
    sign > 0 ? 'text-emerald-500' : sign < 0 ? 'text-rose-500' : 'text-semi-color-text-2';
  const Icon = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon size={12} strokeWidth={2.5} />
      {percent === null ? t('新增') : `${percent.toFixed(1)}%`}
    </span>
  );
};

const StatItem = ({ label, value, sign, percent, t, accent }) => (
  <Card
    className='!rounded-2xl border-0 w-full'
    bodyStyle={{ padding: 18 }}
    style={{ background: 'var(--semi-color-bg-1)' }}
  >
    <div className='flex items-start justify-between gap-3'>
      <div className='min-w-0'>
        <Text type='tertiary' size='small' className='block mb-1'>
          {label}
        </Text>
        <div
          className='text-2xl font-bold leading-tight truncate'
          style={{ color: accent || 'var(--semi-color-text-0)' }}
        >
          {value}
        </div>
      </div>
      <DeltaTag sign={sign} percent={percent} t={t} />
    </div>
    <Text type='tertiary' size='small' className='block mt-2'>
      {t('对比昨日')}
    </Text>
  </Card>
);

const TodayStatsCards = ({ stats, loading }) => {
  const { t } = useTranslation();

  if (loading && !stats) {
    return (
      <div className='mb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className='!rounded-2xl border-0' bodyStyle={{ padding: 18 }}>
            <Skeleton placeholder={<Skeleton.Title />} loading active />
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const items = [
    {
      key: 'quota',
      label: t('今日消耗额度'),
      value: renderQuota(stats.quota || 0),
      previous: stats.yesterday_quota || 0,
      current: stats.quota || 0,
      accent: 'var(--semi-color-primary)',
    },
    {
      key: 'requests',
      label: t('今日请求数'),
      value: renderNumber(stats.requests || 0),
      previous: stats.yesterday_requests || 0,
      current: stats.requests || 0,
    },
    {
      key: 'tokens',
      label: t('今日 Token 数'),
      value: renderNumber(stats.tokens || 0),
      previous: stats.yesterday_tokens || 0,
      current: stats.tokens || 0,
    },
    {
      key: 'active_users',
      label: t('今日活跃用户'),
      value: renderNumber(stats.active_users || 0),
      previous: stats.yesterday_active_users || 0,
      current: stats.active_users || 0,
    },
  ];

  return (
    <div className='mb-4'>
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
        {items.map((item) => {
          const delta = computeDelta(item.current, item.previous);
          return (
            <StatItem
              key={item.key}
              label={item.label}
              value={item.value}
              sign={delta.sign}
              percent={delta.percent}
              accent={item.accent}
              t={t}
            />
          );
        })}
      </div>
    </div>
  );
};

export default TodayStatsCards;
