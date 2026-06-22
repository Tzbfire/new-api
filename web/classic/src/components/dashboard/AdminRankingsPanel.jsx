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
import { Card, Empty, Tabs, TabPane, Tag, Typography } from '@douyinfe/semi-ui';
import { renderNumber, renderQuota, timestamp2string } from '../../helpers';

const { Text } = Typography;

const AdminRankingsPanel = ({
  rankings,
  loading,
  t,
  usageRankings,
  rankingsPeriod,
  onPeriodChange,
}) => {
  const sections = [
    {
      key: 'by_request_count',
      title: t('请求次数 Top 10'),
      items: rankings?.by_request_count || [],
      renderMetric: (item) => renderNumber(item.request_count || 0),
    },
    {
      key: 'by_used_quota',
      title: t('已用额度 Top 10'),
      items: rankings?.by_used_quota || [],
      renderMetric: (item) => renderQuota(item.used_quota || 0),
    },
    {
      key: 'by_last_request',
      title: t('最近请求 Top 10'),
      items: rankings?.by_last_request || [],
      renderMetric: (item) =>
        item.last_request_at > 0 ? timestamp2string(item.last_request_at) : t('未记录'),
    },
  ];

  const periodAware = Array.isArray(usageRankings);

  return (
    <div className='mb-4 space-y-4'>
      {periodAware && (
        <Card
          className='!rounded-2xl'
          title={t('用户消耗排行')}
          loading={loading}
          headerExtraContent={
            <Tabs
              type='button'
              size='small'
              activeKey={rankingsPeriod}
              onChange={onPeriodChange}
            >
              <TabPane tab={t('今日')} itemKey='today' />
              <TabPane tab={t('7日')} itemKey='7d' />
              <TabPane tab={t('30日')} itemKey='30d' />
              <TabPane tab={t('累计')} itemKey='all' />
            </Tabs>
          }
        >
          {usageRankings.length > 0 ? (
            <div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
              {usageRankings.map((item, index) => (
                <div
                  key={`usage-rank-${item.user_id}-${index}`}
                  className='flex items-center justify-between gap-3 px-3 py-2 rounded-lg'
                  style={{ background: 'var(--semi-color-fill-0)' }}
                >
                  <div className='flex items-center gap-2 min-w-0'>
                    <Tag color='white' shape='circle'>#{index + 1}</Tag>
                    <div className='min-w-0'>
                      <Text strong className='block truncate'>
                        {item.username || `user#${item.user_id}`}
                      </Text>
                      <Text type='tertiary' size='small' className='block truncate'>
                        {renderNumber(item.requests || 0)} {t('次')}
                        {item.top_model_name ? ` · ${item.top_model_name}` : ''}
                      </Text>
                    </div>
                  </div>
                  <div className='text-right flex-shrink-0'>
                    <Text strong>{renderQuota(item.quota || 0)}</Text>
                    <Text type='tertiary' size='small' className='block'>
                      {renderNumber(item.tokens || 0)} tokens
                    </Text>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('该时间段暂无消耗数据')}
            />
          )}
        </Card>
      )}

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-4'>
        {sections.map((section) => (
          <Card key={section.key} className='!rounded-2xl' title={section.title} loading={loading}>
            {section.items.length > 0 ? (
              <div className='space-y-3'>
                {section.items.map((item, index) => (
                  <div key={`${section.key}-${item.id}-${index}`} className='flex items-center justify-between gap-3'>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <Text strong>{item.display_name || item.username}</Text>
                        <Tag color='white' shape='circle'>#{index + 1}</Tag>
                      </div>
                      <Text type='tertiary' size='small' className='block truncate'>
                        {item.username}
                        {item.group ? ` · ${item.group}` : ''}
                      </Text>
                    </div>
                    <Text strong>{section.renderMetric(item)}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无数据')} />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminRankingsPanel;
