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
import { Card, Skeleton, Tag, Typography } from '@douyinfe/semi-ui';
import { renderNumber } from '../../../helpers';

const { Text } = Typography;

const UsersStatsCards = ({ summary, loading, t }) => {
  const cards = [
    {
      key: 'total',
      title: t('用户总数'),
      value: summary.total,
      color: 'blue',
    },
    {
      key: 'active_count',
      title: t('已启用'),
      value: summary.active_count,
      color: 'green',
    },
    {
      key: 'disabled_count',
      title: t('已禁用'),
      value: summary.disabled_count,
      color: 'red',
    },
    {
      key: 'subscribed_count',
      title: t('有订阅'),
      value: summary.subscribed_count,
      color: 'violet',
    },
    {
      key: 'recently_active_count',
      title: t('近 7 天活跃'),
      value: summary.recently_active_count,
      color: 'cyan',
    },
  ];

  return (
    <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-2'>
      {cards.map((item) => (
        <Card key={item.key} className='!rounded-2xl border-0 bg-semi-color-fill-0'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <Text type='tertiary' size='small'>
                {item.title}
              </Text>
              <div className='mt-2 text-2xl font-semibold'>
                <Skeleton
                  loading={loading}
                  active
                  placeholder={<Skeleton.Paragraph rows={1} style={{ width: 72, height: 26 }} />}
                >
                  {renderNumber(item.value || 0)}
                </Skeleton>
              </div>
            </div>
            <Tag color={item.color} shape='circle'>
              {item.title}
            </Tag>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default UsersStatsCards;
