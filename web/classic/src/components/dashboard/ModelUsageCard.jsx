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

import React, { useMemo } from 'react';
import { Card, Empty, Tag, Typography, Tabs, TabPane } from '@douyinfe/semi-ui';
import { VChart } from '@visactor/react-vchart';
import { useTranslation } from 'react-i18next';
import { renderNumber, renderQuota } from '../../helpers';

const { Text } = Typography;

const PALETTE = [
  '#6366F1', '#22C55E', '#F59E0B', '#EF4444', '#06B6D4',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#84CC16',
];

const ModelUsageCard = ({ items, period, onPeriodChange, loading }) => {
  const { t } = useTranslation();

  const totalQuota = useMemo(
    () => (items || []).reduce((acc, x) => acc + (x.quota || 0), 0),
    [items],
  );

  const pieSpec = useMemo(() => {
    if (!items || items.length === 0) return null;
    return {
      type: 'pie',
      data: [
        {
          id: 'model_usage',
          values: items.map((x) => ({
            type: x.model_name,
            value: x.quota || 0,
          })),
        },
      ],
      outerRadius: 0.8,
      innerRadius: 0.55,
      categoryField: 'type',
      valueField: 'value',
      color: PALETTE,
      legends: { visible: false },
      label: { visible: false },
      tooltip: { mark: { visible: true } },
    };
  }, [items]);

  return (
    <Card
      className='!rounded-2xl'
      title={t('模型用量占比')}
      headerExtraContent={
        <Tabs
          type='button'
          size='small'
          activeKey={period}
          onChange={onPeriodChange}
        >
          <TabPane tab={t('今日')} itemKey='today' />
          <TabPane tab={t('7日')} itemKey='7d' />
          <TabPane tab={t('30日')} itemKey='30d' />
          <TabPane tab={t('累计')} itemKey='all' />
        </Tabs>
      }
      loading={loading}
    >
      {!items || items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('该时间段暂无模型调用数据')}
          style={{ padding: 24 }}
        />
      ) : (
        <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
          <div style={{ height: 280 }}>
            {pieSpec && <VChart spec={pieSpec} />}
          </div>
          <div className='space-y-2 max-h-[280px] overflow-y-auto pr-1'>
            {items.map((item, idx) => {
              const percent =
                totalQuota > 0 ? ((item.quota || 0) / totalQuota) * 100 : 0;
              const color = PALETTE[idx % PALETTE.length];
              return (
                <div
                  key={`${item.model_name}-${idx}`}
                  className='flex items-center justify-between gap-3 px-3 py-2 rounded-lg'
                  style={{ background: 'var(--semi-color-fill-0)' }}
                >
                  <div className='flex items-center gap-2 min-w-0'>
                    <span
                      className='inline-block w-2.5 h-2.5 rounded-full flex-shrink-0'
                      style={{ background: color }}
                    />
                    <div className='min-w-0'>
                      <Text strong className='block truncate' style={{ maxWidth: 180 }}>
                        {item.model_name}
                      </Text>
                      <Text type='tertiary' size='small'>
                        {renderNumber(item.requests || 0)} {t('次')} · {renderNumber(item.tokens || 0)} tokens
                      </Text>
                    </div>
                  </div>
                  <div className='text-right flex-shrink-0'>
                    <Text strong>{renderQuota(item.quota || 0)}</Text>
                    <Tag color='white' shape='circle' size='small' className='ml-2'>
                      {percent.toFixed(1)}%
                    </Tag>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
};

export default ModelUsageCard;
