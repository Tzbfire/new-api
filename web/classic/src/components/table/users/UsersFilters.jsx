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

import React, { useRef } from 'react';
import { Form, Button } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';

const ROLE_OPTIONS = [
  { value: 1, labelKey: '普通用户' },
  { value: 10, labelKey: '管理员' },
  { value: 100, labelKey: '超级管理员' },
];

const STATUS_OPTIONS = [
  { value: 1, labelKey: '已启用' },
  { value: 2, labelKey: '已禁用' },
];

const SUBSCRIPTION_OPTIONS = [
  { value: 'true', labelKey: '有订阅' },
  { value: 'false', labelKey: '无订阅' },
];

const ACTIVE_OPTIONS = [
  { value: 1, labelKey: '近 1 天' },
  { value: 7, labelKey: '近 7 天' },
  { value: 30, labelKey: '近 30 天' },
];

const QUOTA_OPTIONS = [
  { value: 'healthy', labelKey: '额度充足' },
  { value: 'low', labelKey: '低额度' },
  { value: 'exhausted', labelKey: '已耗尽' },
];

const UsersFilters = ({
  formInitValues,
  setFormApi,
  searchUsers,
  loadUsers,
  pageSize,
  groupOptions,
  loading,
  searching,
  t,
}) => {
  const formApiRef = useRef(null);

  const handleReset = () => {
    if (!formApiRef.current) return;
    formApiRef.current.reset();
    setTimeout(() => {
      loadUsers(1, pageSize);
    }, 100);
  };

  const handleQuickSearch = () => {
    searchUsers(1, pageSize);
  };

  return (
    <Form
      initValues={formInitValues}
      getFormApi={(api) => {
        setFormApi(api);
        formApiRef.current = api;
      }}
      onSubmit={() => {
        handleQuickSearch();
      }}
      allowEmpty={true}
      autoComplete='off'
      layout='horizontal'
      trigger='change'
      stopValidateWithError={false}
      className='w-full md:w-auto order-1 md:order-2'
    >
      <div className='flex flex-col md:flex-row items-center gap-2 w-full md:w-auto flex-wrap'>
        <div className='relative w-full md:w-64'>
          <Form.Input
            field='searchKeyword'
            prefix={<IconSearch />}
            placeholder={t('支持搜索用户的 ID、用户名、显示名称和邮箱地址')}
            showClear
            pure
            size='small'
          />
        </div>
        <div className='w-full md:w-40'>
          <Form.Select
            field='searchGroup'
            placeholder={t('选择分组')}
            optionList={groupOptions}
            onChange={() => {
              setTimeout(() => {
                handleQuickSearch();
              }, 100);
            }}
            className='w-full'
            showClear
            pure
            size='small'
          />
        </div>
        <div className='w-full md:w-36'>
          <Form.Select
            field='searchRole'
            placeholder={t('角色')}
            optionList={ROLE_OPTIONS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={() => {
              setTimeout(() => {
                handleQuickSearch();
              }, 100);
            }}
            className='w-full'
            showClear
            pure
            size='small'
          />
        </div>
        <div className='w-full md:w-36'>
          <Form.Select
            field='searchStatus'
            placeholder={t('状态')}
            optionList={STATUS_OPTIONS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={() => {
              setTimeout(() => {
                handleQuickSearch();
              }, 100);
            }}
            className='w-full'
            showClear
            pure
            size='small'
          />
        </div>
        <div className='w-full md:w-36'>
          <Form.Select
            field='searchHasSubscription'
            placeholder={t('订阅')}
            optionList={SUBSCRIPTION_OPTIONS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={() => {
              setTimeout(() => {
                handleQuickSearch();
              }, 100);
            }}
            className='w-full'
            showClear
            pure
            size='small'
          />
        </div>
        <div className='w-full md:w-36'>
          <Form.Select
            field='searchActiveWithinDays'
            placeholder={t('最近活跃')}
            optionList={ACTIVE_OPTIONS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={() => {
              setTimeout(() => {
                handleQuickSearch();
              }, 100);
            }}
            className='w-full'
            showClear
            pure
            size='small'
          />
        </div>
        <div className='w-full md:w-36'>
          <Form.Select
            field='searchQuotaHealth'
            placeholder={t('额度健康度')}
            optionList={QUOTA_OPTIONS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={() => {
              setTimeout(() => {
                handleQuickSearch();
              }, 100);
            }}
            className='w-full'
            showClear
            pure
            size='small'
          />
        </div>
        <div className='flex gap-2 w-full md:w-auto'>
          <Button
            type='tertiary'
            htmlType='submit'
            loading={loading || searching}
            className='flex-1 md:flex-initial md:w-auto'
            size='small'
          >
            {t('查询')}
          </Button>
          <Button
            type='tertiary'
            onClick={handleReset}
            className='flex-1 md:flex-initial md:w-auto'
            size='small'
          >
            {t('重置')}
          </Button>
        </div>
      </div>
    </Form>
  );
};

export default UsersFilters;
