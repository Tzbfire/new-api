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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Descriptions,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  API,
  renderNumber,
  renderQuota,
  showError,
  showSuccess,
  timestamp2string,
} from '../../../../helpers';

const { Text, Paragraph } = Typography;

const TOKEN_PAGE_SIZE = 20;

const BILLING_PREFERENCE_OPTIONS = [
  { value: 'subscription_first', labelKey: '优先订阅' },
  { value: 'wallet_first', labelKey: '优先钱包' },
  { value: 'subscription_only', labelKey: '仅用订阅' },
  { value: 'wallet_only', labelKey: '仅用钱包' },
];

const getUserStatusMeta = (user, t) => {
  if (!user) {
    return { text: '-', color: 'grey' };
  }
  if (user.DeletedAt !== null) {
    return { text: t('已注销'), color: 'red' };
  }
  if (user.status === 1) {
    return { text: t('已启用'), color: 'green' };
  }
  if (user.status === 2) {
    return { text: t('已禁用'), color: 'red' };
  }
  return { text: t('未知状态'), color: 'grey' };
};

const getRoleMeta = (role, t) => {
  if (role === 100) {
    return { text: t('超级管理员'), color: 'orange' };
  }
  if (role === 10) {
    return { text: t('管理员'), color: 'yellow' };
  }
  if (role === 1) {
    return { text: t('普通用户'), color: 'blue' };
  }
  return { text: t('未知身份'), color: 'grey' };
};

const formatMaybeTimestamp = (timestamp, t) => {
  const value = Number(timestamp || 0);
  if (value <= 0) {
    return t('未记录');
  }
  return timestamp2string(value);
};

const ReviewSection = ({ title, children, extra = null }) => (
  <Card className='!rounded-xl'>
    <div className='flex items-center justify-between gap-3 mb-3'>
      <Text strong>{title}</Text>
      {extra}
    </div>
    {children}
  </Card>
);

const confirmModal = Modal.confirm;

const UserReviewModal = ({ visible, onCancel, user, t }) => {
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewSummary, setReviewSummary] = useState(null);
  const [billingPreference, setBillingPreference] = useState('subscription_first');
  const [savingBillingPreference, setSavingBillingPreference] = useState(false);
  const [userGroup, setUserGroup] = useState('default');
  const [savingUserGroup, setSavingUserGroup] = useState(false);
  const [adminTokens, setAdminTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [revealingTokenId, setRevealingTokenId] = useState(null);
  const [savingTokenGroupId, setSavingTokenGroupId] = useState(null);
  const [resettingSubscriptionId, setResettingSubscriptionId] = useState(null);

  useEffect(() => {
    if (!visible) {
      setReviewSummary(null);
      setBillingPreference('subscription_first');
      setUserGroup('default');
      setAdminTokens([]);
      setLoadingTokens(false);
      setRevealingTokenId(null);
      setSavingTokenGroupId(null);
      setResettingSubscriptionId(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !user?.id) {
      return;
    }

    let disposed = false;

    const loadReviewSummary = async () => {
      setDetailLoading(true);
      setLoadingTokens(true);
      try {
        const [reviewRes, tokenRes] = await Promise.all([
          API.get(`/api/user/${user.id}/review`),
          API.get(`/api/user/${user.id}/tokens?p=0&size=${TOKEN_PAGE_SIZE}`),
        ]);
        const { success, message, data } = reviewRes.data;
        if (!success) {
          showError(message || t('加载用户审阅数据失败'));
          return;
        }
        if (!disposed) {
          const summary = data || null;
          setReviewSummary(summary);
          setBillingPreference(summary?.billing_preference || 'subscription_first');
          setUserGroup(summary?.user?.group || 'default');
          const tokenSuccess = tokenRes.data?.success;
          if (!tokenSuccess) {
            showError(tokenRes.data?.message || t('加载用户 API Keys 失败'));
          }
          setAdminTokens(tokenSuccess ? tokenRes.data?.data?.items || [] : []);
        }
      } catch (error) {
        if (!disposed) {
          showError(t('加载用户审阅数据失败'));
        }
      } finally {
        if (!disposed) {
          setDetailLoading(false);
          setLoadingTokens(false);
        }
      }
    };

    loadReviewSummary().catch(() => {});

    return () => {
      disposed = true;
    };
  }, [visible, user?.id, t]);

  const reviewUser = reviewSummary?.user || user;
  const statusMeta = getUserStatusMeta(reviewUser, t);
  const roleMeta = getRoleMeta(reviewUser?.role, t);
  const subscriptions = Array.isArray(reviewSummary?.subscriptions)
    ? reviewSummary.subscriptions
    : [];
  const security = reviewSummary?.security || {};
  const usage = reviewSummary?.usage || {};

  const handleSaveBillingPreference = async () => {
    if (!reviewUser?.id) {
      return;
    }
    setSavingBillingPreference(true);
    try {
      const res = await API.put(`/api/user/${reviewUser.id}/billing-preference`, {
        billing_preference: billingPreference,
      });
      const { success, message, data } = res.data;
      if (!success) {
        showError(message || t('保存扣费优先级失败'));
        return;
      }
      const nextPreference = data?.billing_preference || billingPreference;
      setBillingPreference(nextPreference);
      setReviewSummary((prev) =>
        prev
          ? {
              ...prev,
              billing_preference: nextPreference,
            }
          : prev,
      );
      showSuccess(t('保存成功'));
    } catch (error) {
      showError(t('保存扣费优先级失败'));
    } finally {
      setSavingBillingPreference(false);
    }
  };

  const handleSaveUserGroup = async () => {
    if (!reviewUser?.id) {
      return;
    }
    setSavingUserGroup(true);
    try {
      const res = await API.put(`/api/user/${reviewUser.id}/group`, {
        group: userGroup,
      });
      const { success, message, data } = res.data;
      if (!success) {
        showError(message || t('保存用户分组失败'));
        return;
      }
      const nextGroup = data?.group || userGroup;
      setUserGroup(nextGroup);
      setReviewSummary((prev) =>
        prev
          ? {
              ...prev,
              user: {
                ...(prev.user || {}),
                group: nextGroup,
              },
            }
          : prev,
      );
      showSuccess(t('保存成功'));
    } catch (error) {
      showError(t('保存用户分组失败'));
    } finally {
      setSavingUserGroup(false);
    }
  };

  const handleRevealTokenKey = async (tokenId) => {
    if (!reviewUser?.id || !tokenId) {
      return;
    }
    setRevealingTokenId(tokenId);
    try {
      const res = await API.post(`/api/user/${reviewUser.id}/tokens/${tokenId}/key`);
      const { success, message, data } = res.data;
      if (!success) {
        showError(message || t('查看 API Key 失败'));
        return;
      }
      const fullKey = data?.key || '';
      setAdminTokens((prev) =>
        prev.map((token) =>
          token.id === tokenId
            ? {
                ...token,
                key: fullKey,
                full_key_visible: true,
              }
            : token,
        ),
      );
      showSuccess(t('已显示完整 API Key'));
    } catch (error) {
      showError(t('查看 API Key 失败'));
    } finally {
      setRevealingTokenId(null);
    }
  };

  const handleSaveTokenGroup = async (tokenId, nextGroup) => {
    if (!reviewUser?.id || !tokenId || !nextGroup) {
      return;
    }
    setSavingTokenGroupId(tokenId);
    try {
      const res = await API.put(`/api/user/${reviewUser.id}/tokens/${tokenId}/group`, {
        group: nextGroup,
      });
      const { success, message, data } = res.data;
      if (!success) {
        showError(message || t('保存令牌分组失败'));
        return;
      }
      const savedGroup = data?.group || nextGroup;
      setAdminTokens((prev) =>
        prev.map((token) =>
          token.id === tokenId
            ? {
                ...token,
                group: savedGroup,
              }
            : token,
        ),
      );
      showSuccess(t('保存成功'));
    } catch (error) {
      showError(t('保存令牌分组失败'));
    } finally {
      setSavingTokenGroupId(null);
    }
  };

  const handleResetSubscriptionQuota = async (subscriptionId) => {
    if (!subscriptionId) {
      return;
    }
    confirmModal({
      title: t('确认重置该订阅用量？'),
      content: t('此操作会将当前订阅的已用额度清零，但不会修改订阅总额度、到期时间和自动重置周期。'),
      okText: t('确认重置'),
      cancelText: t('取消'),
      okButtonProps: {
        loading: resettingSubscriptionId === subscriptionId,
      },
      onOk: async () => {
        setResettingSubscriptionId(subscriptionId);
        try {
          const res = await API.post(`/api/subscription/admin/user_subscriptions/${subscriptionId}/reset_quota`);
          const { success, message } = res.data;
          if (!success) {
            showError(message || t('重置订阅用量失败'));
            return;
          }
          setReviewSummary((prev) => {
            if (!prev) {
              return prev;
            }
            return {
              ...prev,
              subscriptions: (prev.subscriptions || []).map((item) => {
                const currentId = item?.subscription?.id;
                if (currentId !== subscriptionId) {
                  return item;
                }
                return {
                  ...item,
                  subscription: {
                    ...item.subscription,
                    amount_used: 0,
                  },
                };
              }),
            };
          });
          showSuccess(t('重置成功'));
        } catch (error) {
          showError(t('重置订阅用量失败'));
        } finally {
          setResettingSubscriptionId(null);
        }
      },
    });
  };

  const groupOptions = useMemo(() => {
    const availableGroups = reviewSummary?.available_groups || {};
    return Object.keys(availableGroups).map((group) => ({
      value: group,
      label: `${group}${availableGroups[group] ? ` · ${availableGroups[group]}` : ''}`,
    }));
  }, [reviewSummary?.available_groups]);

  const bindingRows = useMemo(() => {
    const rows = Array.isArray(reviewSummary?.bindings) ? reviewSummary.bindings : [];
    return rows.filter((item) => item?.value);
  }, [reviewSummary?.bindings]);

  const tokenRows = useMemo(() => {
    return adminTokens.map((token) => ({
      id: token.id,
      name: token.name || '-',
      group: token.group || '-',
      status: token.status,
      remainQuota: token.unlimited_quota ? t('无限额度') : renderQuota(token.remain_quota || 0),
      keyText: token.key || '-',
      isVisible: !!token.full_key_visible,
      groupOptions,
    }));
  }, [adminTokens, groupOptions, t]);

  const overviewRows = [
    {
      key: t('状态'),
      value: <Tag color={statusMeta.color} shape='circle'>{statusMeta.text}</Tag>,
    },
    {
      key: t('角色'),
      value: <Tag color={roleMeta.color} shape='circle'>{roleMeta.text}</Tag>,
    },
    {
      key: t('分组'),
      value: userGroup || reviewUser?.group || '-',
    },
    {
      key: t('显示名称'),
      value: reviewUser?.display_name || '-',
    },
    {
      key: t('注册时间'),
      value: formatMaybeTimestamp(reviewUser?.created_at, t),
    },
    {
      key: t('最近登录'),
      value: formatMaybeTimestamp(reviewUser?.last_login_at, t),
    },
    {
      key: t('最近请求'),
      value: formatMaybeTimestamp(reviewUser?.last_request_at, t),
    },
    {
      key: t('最近活跃'),
      value: reviewSummary?.is_recently_active ? t('是') : t('否'),
    },
  ];

  const commercialRows = [
    {
      key: t('剩余额度'),
      value: renderQuota(reviewUser?.quota || 0),
    },
    {
      key: t('已用额度'),
      value: renderQuota(usage.used_quota || reviewUser?.used_quota || 0),
    },
    {
      key: t('调用次数'),
      value: renderNumber(usage.request_count || reviewUser?.request_count || 0),
    },
    {
      key: t('订阅状态'),
      value: reviewSummary?.has_subscription ? t('已订阅') : t('无订阅'),
    },
    {
      key: t('当前订阅计划'),
      value: reviewSummary?.subscription_plan || '-',
    },
    {
      key: t('扣费优先级'),
      value: BILLING_PREFERENCE_OPTIONS.find((item) => item.value === billingPreference)
        ? t(
            BILLING_PREFERENCE_OPTIONS.find((item) => item.value === billingPreference)
              .labelKey,
          )
        : billingPreference,
    },
    {
      key: t('邀请收益'),
      value: renderQuota(reviewUser?.aff_history_quota || 0),
    },
  ];

  const relationRows = [
    {
      key: t('邀请人 ID'),
      value: reviewUser?.inviter_id ? reviewUser.inviter_id : t('无邀请人'),
    },
    {
      key: t('邀请码'),
      value: reviewUser?.aff_code || '-',
    },
    {
      key: t('邀请人数'),
      value: renderNumber(reviewUser?.aff_count || 0),
    },
    {
      key: t('当前返佣额度'),
      value: renderQuota(reviewUser?.aff_quota || 0),
    },
    {
      key: t('累计返佣额度'),
      value: renderQuota(reviewUser?.aff_history_quota || 0),
    },
  ];

  const activityRows = [
    {
      key: t('调用次数'),
      value: renderNumber(usage.request_count || reviewUser?.request_count || 0),
    },
    {
      key: t('已用额度'),
      value: renderQuota(usage.used_quota || reviewUser?.used_quota || 0),
    },
    {
      key: t('最近请求'),
      value: formatMaybeTimestamp(usage.last_request_at || reviewUser?.last_request_at, t),
    },
    {
      key: t('最后活跃时间'),
      value: formatMaybeTimestamp(reviewSummary?.last_activity_at, t),
    },
    {
      key: t('最近活跃窗口'),
      value: reviewSummary?.recently_active_days
        ? t('近 {{days}} 天', { days: reviewSummary.recently_active_days })
        : '-',
    },
  ];

  const securityRows = [
    {
      key: '2FA',
      value:
        reviewSummary?.has_two_fa || security.has_2fa ? t('已启用') : t('未启用'),
    },
    {
      key: 'Passkey',
      value:
        reviewSummary?.has_passkey || security.has_passkey
          ? t('已启用')
          : t('未启用'),
    },
    {
      key: t('绑定数量'),
      value: renderNumber(reviewSummary?.binding_count || security.binding_count || 0),
    },
  ];

  const getTokenStatusText = (status) => {
    if (status === 1) {
      return t('已启用');
    }
    if (status === 2) {
      return t('已禁用');
    }
    if (status === 3) {
      return t('已过期');
    }
    if (status === 4) {
      return t('已耗尽');
    }
    return t('未知状态');
  };

  return (
    <Modal
      centered
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={960}
      title={
        <div className='flex items-center gap-2'>
          <Badge dot type='primary' />
          {t('审阅用户')} {reviewUser?.username || ''}
        </div>
      }
    >
      <Spin spinning={detailLoading}>
        <div className='max-h-[72vh] overflow-y-auto pr-1 pb-2 space-y-4'>
          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('账号概览')}>
              <Descriptions data={overviewRows} column={1} />
              <div className='mt-3 flex items-center gap-2'>
                <Select
                  size='small'
                  value={userGroup}
                  onChange={setUserGroup}
                  optionList={groupOptions}
                />
                <Button
                  size='small'
                  type='primary'
                  loading={savingUserGroup}
                  onClick={handleSaveUserGroup}
                >
                  {t('保存分组')}
                </Button>
              </div>
              {reviewUser?.remark ? (
                <div className='mt-3'>
                  <Text type='tertiary' size='small'>
                    {t('备注')}
                  </Text>
                  <Paragraph className='!mb-0 mt-1 break-all'>
                    {reviewUser.remark}
                  </Paragraph>
                </div>
              ) : null}
            </ReviewSection>

            <ReviewSection
              title={t('商业信息')}
              extra={
                <div className='flex items-center gap-2'>
                  <Select
                    size='small'
                    value={billingPreference}
                    onChange={setBillingPreference}
                    optionList={BILLING_PREFERENCE_OPTIONS.map((item) => ({
                      value: item.value,
                      label: t(item.labelKey),
                    }))}
                  />
                  <Button
                    size='small'
                    type='primary'
                    loading={savingBillingPreference}
                    onClick={handleSaveBillingPreference}
                  >
                    {t('保存')}
                  </Button>
                </div>
              }
            >
              <Descriptions data={commercialRows} column={1} />
            </ReviewSection>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('订阅与绑定信息')}>
              <Descriptions data={relationRows} column={1} />
              {bindingRows.length > 0 ? (
                <div className='mt-3 flex flex-wrap gap-2'>
                  {bindingRows.map((item) => (
                    <Tag key={item.key} color='white' shape='circle'>
                      {item.label}: {item.value}
                      {item.is_custom && item.provider_id
                        ? ` (${t('自定义 OAuth')} #${item.provider_id})`
                        : ''}
                    </Tag>
                  ))}
                </div>
              ) : (
                <Text type='tertiary' size='small'>
                  {t('暂无绑定账号')}
                </Text>
              )}
            </ReviewSection>

            <ReviewSection title={t('订阅管理')}>
              {subscriptions.length > 0 ? (
                <div className='space-y-3'>
                  {subscriptions.map((subscription, index) => {
                    const subscriptionData = subscription?.subscription || {};
                    const subscriptionId = subscriptionData.id || index;
                    const remainQuota = subscriptionData.amount_total > 0
                      ? renderQuota((subscriptionData.amount_total || 0) - (subscriptionData.amount_used || 0))
                      : t('无限额度');
                    return (
                      <Card
                        key={`${subscriptionData.id || subscription.subscription_id || index}`}
                        className='!rounded-lg !shadow-none border border-[var(--semi-color-border)]'
                      >
                        <div className='flex flex-col gap-3'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <Tag color='green' shape='circle'>
                              {subscription.plan_title || subscription.subscription_plan || t('订阅计划')}
                            </Tag>
                            <Tag color='white' shape='circle'>
                              {t('已用')}: {renderQuota(subscriptionData.amount_used || 0)}
                            </Tag>
                            <Tag color='white' shape='circle'>
                              {t('剩余')}: {remainQuota}
                            </Tag>
                          </div>
                          <div className='flex justify-end'>
                            <Button
                              size='small'
                              type='danger'
                              theme='light'
                              loading={resettingSubscriptionId === subscriptionId}
                              onClick={() => handleResetSubscriptionQuota(subscriptionId)}
                            >
                              {t('重置订阅用量')}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Text type='tertiary' size='small'>
                  {t('暂无订阅记录')}
                </Text>
              )}
            </ReviewSection>

            <ReviewSection title={t('活跃与使用')}>
              <Descriptions data={activityRows} column={1} />
            </ReviewSection>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
            <ReviewSection title={t('安全信息')}>
              <Descriptions data={securityRows} column={1} />
            </ReviewSection>

            <ReviewSection title={t('API Keys')}>
              {loadingTokens ? (
                <div className='py-6 flex justify-center'>
                  <Spin spinning />
                </div>
              ) : tokenRows.length > 0 ? (
                <div className='space-y-3'>
                  {tokenRows.map((token) => (
                    <Card key={token.id} className='!rounded-lg !shadow-none border border-[var(--semi-color-border)]'>
                      <div className='flex flex-col gap-3'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <Tag color='blue' shape='circle'>{token.name}</Tag>
                          <Tag color='white' shape='circle'>{t('分组')}: {token.group}</Tag>
                          <Tag color='grey' shape='circle'>{getTokenStatusText(token.status)}</Tag>
                          <Tag color='white' shape='circle'>{t('额度')}: {token.remainQuota}</Tag>
                        </div>
                        <div className='flex items-center gap-2 flex-wrap'>
                          <Text>{t('令牌分组')}</Text>
                          <Select
                            size='small'
                            value={token.group}
                            optionList={token.groupOptions}
                            loading={savingTokenGroupId === token.id}
                            onChange={(value) => handleSaveTokenGroup(token.id, value)}
                          />
                        </div>
                        <div className='flex items-center gap-2 flex-wrap'>
                          <Text className='break-all'>{token.keyText}</Text>
                          <Button
                            size='small'
                            type='primary'
                            theme='light'
                            loading={revealingTokenId === token.id}
                            disabled={token.isVisible}
                            onClick={() => handleRevealTokenKey(token.id)}
                          >
                            {token.isVisible ? t('已显示') : t('查看完整 Key')}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <Text type='tertiary' size='small'>
                  {t('暂无 API Keys')}
                </Text>
              )}
            </ReviewSection>
          </div>

          <div className='flex justify-end'>
            <Button onClick={onCancel}>{t('关闭')}</Button>
          </div>
        </div>
      </Spin>
    </Modal>
  );
};

export default UserReviewModal;
