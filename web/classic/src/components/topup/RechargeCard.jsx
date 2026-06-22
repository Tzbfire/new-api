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

import React, { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Typography,
  Card,
  Button,
  Banner,
  Skeleton,
  Form,
  Space,
  Row,
  Col,
  Spin,
  Tabs,
  TabPane,
} from '@douyinfe/semi-ui';
import { SiAlipay, SiWechat, SiStripe } from 'react-icons/si';
import {
  CreditCard,
  Coins,
  Wallet,
  BarChart2,
  TrendingUp,
  Receipt,
  Sparkles,
} from 'lucide-react';
import { IconGift } from '@douyinfe/semi-icons';
import { useMinimumLoadingTime } from '../../hooks/common/useMinimumLoadingTime';
import { useActualTheme } from '../../context/Theme';
import { getCurrencyConfig } from '../../helpers/render';
import SubscriptionPlansCard from './SubscriptionPlansCard';

const { Text } = Typography;

const RechargeCard = ({
  t,
  enableOnlineTopUp,
  enableAlipayNativeTopUp,
  enableStripeTopUp,
  enableCreemTopUp,
  creemProducts,
  creemPreTopUp,
  presetAmounts,
  selectedPreset,
  selectPresetAmount,
  formatLargeNumber,
  priceRatio,
  topUpCount,
  minTopUp,
  renderQuotaWithAmount,
  getAmount,
  setTopUpCount,
  setSelectedPreset,
  renderAmount,
  amountLoading,
  payMethods,
  preTopUp,
  paymentLoading,
  payWay,
  redemptionCode,
  setRedemptionCode,
  topUp,
  isSubmitting,
  topUpLink,
  openTopUpLink,
  userState,
  renderQuota,
  statusLoading,
  topupInfo,
  onOpenHistory,
  enableWaffoTopUp,
  enableWaffoPancakeTopUp,
  subscriptionLoading = false,
  subscriptionPlans = [],
  initialTab = null,
  initialPlanId = null,
  billingPreference,
  onChangeBillingPreference,
  activeSubscriptions = [],
  allSubscriptions = [],
  reloadSubscriptionSelf,
  enableRedemption = true,
}) => {
  const onlineFormApiRef = useRef(null);
  const redeemFormApiRef = useRef(null);
  const initialTabSetRef = useRef(false);
  const showAmountSkeleton = useMinimumLoadingTime(amountLoading);
  const actualTheme = useActualTheme();
  const [activeTab, setActiveTab] = useState('topup');
  const shouldShowSubscription =
    subscriptionLoading ||
    subscriptionPlans.length > 0 ||
    activeSubscriptions.length > 0 ||
    allSubscriptions.length > 0;
  const regularPayMethods = payMethods || [];
  const isPayMethodChannelEnabled = (payMethod) => {
    const type = payMethod?.type;
    const isStripe = type === 'stripe';
    const isAlipayNative = type === 'alipay_native';
    const isWaffo = typeof type === 'string' && type.startsWith('waffo:');
    const isWaffoPancake = type === 'waffo_pancake';

    if (isAlipayNative) return enableAlipayNativeTopUp;
    if (isStripe) return enableStripeTopUp;
    if (isWaffo) return enableWaffoTopUp;
    if (isWaffoPancake) return enableWaffoPancakeTopUp;
    return enableOnlineTopUp;
  };
  const enabledPayMethods = regularPayMethods.filter(isPayMethodChannelEnabled);
  const paymentMethodCount = enabledPayMethods.length;

  useEffect(() => {
    if (initialTabSetRef.current) return;
    if (subscriptionLoading) return;
    const requestedTab = initialTab === 'subscription' || initialTab === 'topup' ? initialTab : null;
    if (requestedTab === 'subscription' && shouldShowSubscription) {
      setActiveTab('subscription');
    } else if (requestedTab === 'topup') {
      setActiveTab('topup');
    } else if (initialPlanId && shouldShowSubscription) {
      setActiveTab('subscription');
    } else {
      setActiveTab('topup');
    }
    initialTabSetRef.current = true;
  }, [initialPlanId, initialTab, shouldShowSubscription, subscriptionLoading]);

  useEffect(() => {
    if (!shouldShowSubscription && activeTab !== 'topup') {
      setActiveTab('topup');
    }
  }, [shouldShowSubscription, activeTab]);

  const topupContent = (
    <Space vertical style={{ width: '100%' }} spacing={20}>
      {/* 顶部账户状态 - Notion / Linear 极简风 */}
      <div className='rounded-xl border border-semi-color-border bg-semi-color-bg-1 px-5 py-4'>
        <div className='flex items-center justify-between flex-wrap gap-4'>
          <div className='flex flex-col leading-tight'>
            <span className='text-xs text-semi-color-text-2 mb-1'>
              {t('当前余额')}
            </span>
            <span className='text-2xl font-semibold tracking-tight'>
              {renderQuota(userState?.user?.quota)}
            </span>
          </div>
          <div className='flex items-center gap-6 text-sm'>
            <div className='flex flex-col leading-tight'>
              <span className='text-xs text-semi-color-text-2 mb-1'>
                {t('历史消耗')}
              </span>
              <span className='font-medium text-semi-color-text-1'>
                {renderQuota(userState?.user?.used_quota)}
              </span>
            </div>
            <div className='hidden sm:flex flex-col leading-tight'>
              <span className='text-xs text-semi-color-text-2 mb-1'>
                {t('请求次数')}
              </span>
              <span className='font-medium text-semi-color-text-1'>
                {userState?.user?.request_count || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 在线充值卡片 */}
      <Card
        className='!rounded-xl w-full !border-semi-color-border !shadow-none'
      >
        {/* 在线充值表单 */}
        {statusLoading ? (
          <div className='py-8 flex justify-center'>
            <Spin size='large' />
          </div>
        ) : enableOnlineTopUp ||
          enableAlipayNativeTopUp ||
          enableStripeTopUp ||
          enableCreemTopUp ||
          enableWaffoTopUp ||
          enableWaffoPancakeTopUp ? (
          <Form
            getFormApi={(api) => (onlineFormApiRef.current = api)}
            initValues={{ topUpCount: topUpCount }}
          >
            <div className='space-y-7'>
              {(enableOnlineTopUp ||
                enableAlipayNativeTopUp ||
                enableStripeTopUp ||
                enableWaffoTopUp ||
                enableWaffoPancakeTopUp) && (
                <Row gutter={12}>
                  <Col xs={24} sm={24} md={24} lg={24} xl={24}>
                    <Form.InputNumber
                      field='topUpCount'
                      label={t('自定义额度')}
                      disabled={
                        !enableOnlineTopUp &&
                        !enableAlipayNativeTopUp &&
                        !enableStripeTopUp &&
                        !enableWaffoTopUp &&
                        !enableWaffoPancakeTopUp
                      }
                      placeholder={
                        t('输入想购买的额度，最低 ') + renderQuotaWithAmount(minTopUp)
                      }
                      value={topUpCount}
                      min={minTopUp}
                      max={999999999}
                      step={1}
                      precision={0}
                      onChange={async (value) => {
                        if (value && value >= 1) {
                          setTopUpCount(value);
                          setSelectedPreset(null);
                          await getAmount(value);
                        }
                      }}
                      onBlur={(e) => {
                        const value = parseInt(e.target.value);
                        if (!value || value < 1) {
                          setTopUpCount(1);
                          getAmount(1);
                        }
                      }}
                      formatter={(value) => (value ? `${value}` : '')}
                      parser={(value) =>
                        value ? parseInt(value.replace(/[^\d]/g, '')) : 0
                      }
                      extraText={
                        <Skeleton
                          loading={showAmountSkeleton}
                          active
                          placeholder={
                            <Skeleton.Title
                              style={{
                                width: 120,
                                height: 20,
                                borderRadius: 6,
                              }}
                            />
                          }
                        >
                          <Text type='secondary' className='text-red-600'>
                            {t('预计支付：')}
                            <span style={{ color: 'red' }}>
                              {renderAmount()}
                            </span>
                          </Text>
                        </Skeleton>
                      }
                      style={{ width: '100%' }}
                    />
                  </Col>
                </Row>
              )}

              {(enableOnlineTopUp ||
                enableAlipayNativeTopUp ||
                enableStripeTopUp ||
                enableWaffoTopUp) && (
                <Form.Slot
                  label={
                    <div className='flex items-center gap-2'>
                      <span className='inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-semi-color-border bg-semi-color-bg-2 px-1.5 text-[11px] font-semibold text-semi-color-text-1'>
                        1
                      </span>
                      <span>{t('选择购买额度')}</span>
                      {(() => {
                        const { symbol, rate, type } = getCurrencyConfig();
                        if (type === 'USD') return null;

                        return (
                          <span
                            style={{
                              color: 'var(--semi-color-text-2)',
                              fontSize: '12px',
                              fontWeight: 'normal',
                            }}
                          >
                            (1 $ = {rate.toFixed(2)} {symbol})
                          </span>
                        );
                      })()}
                    </div>
                  }
                >
                  <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2'>
                    {presetAmounts.map((preset, index) => {
                      const discount =
                        preset.discount ||
                        topupInfo?.discount?.[preset.value] ||
                        1.0;
                      const originalPrice = preset.value * priceRatio;
                      const discountedPrice = originalPrice * discount;
                      const hasDiscount = discount < 1.0;
                      const actualPay = discountedPrice;
                      const save = originalPrice - discountedPrice;

                      // 根据当前货币类型换算显示金额和数量
                      const { symbol, rate, type } = getCurrencyConfig();
                      const statusStr = localStorage.getItem('status');
                      let usdRate = 7; // 默认CNY汇率
                      try {
                        if (statusStr) {
                          const s = JSON.parse(statusStr);
                          usdRate = s?.usd_exchange_rate || 7;
                        }
                      } catch (e) {}

                      let displayValue = preset.value; // 显示的数量
                      let displayActualPay = actualPay;
                      let displaySave = save;

                      if (type === 'USD') {
                        // 数量保持USD，价格从CNY转USD
                        displayActualPay = actualPay / usdRate;
                        displaySave = save / usdRate;
                      } else if (type === 'CNY') {
                        // 数量转CNY，价格已是CNY
                        displayValue = preset.value * usdRate;
                      } else if (type === 'CUSTOM') {
                        // 数量和价格都转自定义货币
                        displayValue = preset.value * rate;
                        displayActualPay = (actualPay / usdRate) * rate;
                        displaySave = (save / usdRate) * rate;
                      }

                      return (
                        <div
                          key={index}
                          onClick={() => selectPresetAmount(preset)}
                          className={
                            'cursor-pointer rounded-lg px-4 py-3 transition-colors ' +
                            (selectedPreset === preset.value
                              ? 'border-2 border-semi-color-primary bg-semi-color-primary-light-default'
                              : 'border border-semi-color-border hover:border-semi-color-text-2')
                          }
                          style={{
                            // 抵消选中时多 1px 边框带来的位移
                            margin: selectedPreset === preset.value ? 0 : '1px',
                          }}
                        >
                          <div className='flex items-baseline justify-between gap-2 mb-1'>
                            <span className='text-base font-semibold tracking-tight'>
                              {formatLargeNumber(displayValue)} {symbol}
                            </span>
                            {hasDiscount && (
                              <span className='text-[11px] font-medium text-semi-color-primary'>
                                {t('折').includes('off')
                                  ? (
                                      (1 - parseFloat(discount)) *
                                      100
                                    ).toFixed(1)
                                  : (discount * 10).toFixed(1)}
                                {t('折')}
                              </span>
                            )}
                          </div>
                          <div className='text-xs text-semi-color-text-2'>
                            {t('支付')} {symbol}
                            {displayActualPay.toFixed(2)}
                            {hasDiscount &&
                              ` · ${t('节省')} ${symbol}${displaySave.toFixed(2)}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Form.Slot>
              )}

              {enabledPayMethods.length > 0 && (
                <Form.Slot
                  label={
                    <div className='flex items-center gap-2'>
                      <span className='inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-semi-color-border bg-semi-color-bg-2 px-1.5 text-[11px] font-semibold text-semi-color-text-1'>
                        2
                      </span>
                      <span>{t('选择付款方式')}</span>
                    </div>
                  }
                >
                  <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                    {enabledPayMethods.map((payMethod) => {
                      const minTopupVal = Number(payMethod.min_topup) || 0;
                      const disabled = minTopupVal > Number(topUpCount || 0);
                      const disabledReason =
                        disabled && minTopupVal > Number(topUpCount || 0)
                          ? t('此支付方式最低充值金额为') + ' ' + minTopupVal
                          : undefined;
                      const isLoading =
                        paymentLoading && payWay === payMethod.type;
                      const iconNode =
                        payMethod.type === 'alipay' ||
                        payMethod.type === 'alipay_native' ? (
                          <SiAlipay size={18} className='text-[#1677FF]' />
                        ) : payMethod.type === 'wxpay' ? (
                          <SiWechat size={18} className='text-[#07C160]' />
                        ) : payMethod.type === 'stripe' ? (
                          <SiStripe size={18} className='text-[#635BFF]' />
                        ) : payMethod.icon ? (
                          <img
                            src={payMethod.icon}
                            alt={payMethod.name}
                            style={{
                              width: 18,
                              height: 18,
                              objectFit: 'contain',
                            }}
                          />
                        ) : (
                          <CreditCard
                            size={18}
                            className='text-semi-color-text-2'
                          />
                        );

                      return (
                        <button
                          key={payMethod.type}
                          type='button'
                          onClick={() => !disabled && preTopUp(payMethod.type)}
                          disabled={disabled || isLoading}
                          title={disabledReason}
                          className={
                            'flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ' +
                            (disabled
                              ? 'border-semi-color-border bg-semi-color-bg-2 opacity-50 cursor-not-allowed'
                              : 'border-semi-color-border bg-semi-color-bg-1 hover:border-semi-color-primary')
                          }
                        >
                          <span className='flex items-center justify-center w-8 h-8'>
                            {iconNode}
                          </span>
                          <span className='flex-1 min-w-0 text-sm font-medium truncate'>
                            {payMethod.name}
                          </span>
                          {isLoading && <Spin size='small' />}
                        </button>
                      );
                    })}
                  </div>
                </Form.Slot>
              )}

              {/* Creem 充值区域 */}
              {enableCreemTopUp && creemProducts.length > 0 && (
                <Form.Slot label={t('Creem 充值')}>
                  <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3'>
                    {creemProducts.map((product, index) => (
                      <Card
                        key={index}
                        onClick={() => creemPreTopUp(product)}
                        className='cursor-pointer !rounded-2xl transition-all hover:shadow-md border-gray-200 hover:border-gray-300'
                        bodyStyle={{ textAlign: 'center', padding: '16px' }}
                      >
                        <div className='font-medium text-lg mb-2'>
                          {product.name}
                        </div>
                        <div className='text-sm text-gray-600 mb-2'>
                          {t('到账额度')}: {product.quota}
                        </div>
                        <div className='text-lg font-semibold text-blue-600'>
                          {product.currency === 'EUR' ? '€' : '$'}
                          {product.price}
                        </div>
                      </Card>
                    ))}
                  </div>
                </Form.Slot>
              )}
            </div>
          </Form>
        ) : (
          <Banner
            type='info'
            description={t(
                '管理员未开启任何在线购买渠道，请联系管理员开启或使用兑换码充值。',
            )}
            className='!rounded-xl'
            closeIcon={null}
          />
        )}
      </Card>

      {/* 兑换码充值 */}
      {enableRedemption ? (
        <Card
          className='!rounded-xl w-full !border-semi-color-border !shadow-none'
          title={
            <Text strong className='!text-sm'>
              {t('兑换码充值')}
            </Text>
          }
        >
          <Form
            getFormApi={(api) => (redeemFormApiRef.current = api)}
            initValues={{ redemptionCode: redemptionCode }}
          >
            <Form.Input
              field='redemptionCode'
              noLabel={true}
              placeholder={t('请输入兑换码')}
              value={redemptionCode}
              onChange={(value) => setRedemptionCode(value)}
              prefix={<IconGift />}
              suffix={
                <div className='flex items-center gap-2'>
                  <Button
                    type='primary'
                    theme='solid'
                    onClick={topUp}
                    loading={isSubmitting}
                  >
                    {t('兑换额度')}
                  </Button>
                </div>
              }
              showClear
              style={{ width: '100%' }}
              extraText={
                topUpLink && (
                  <Text type='tertiary'>
                    {t('在找兑换码？')}
                    <Text
                      type='secondary'
                      underline
                      className='cursor-pointer'
                      onClick={openTopUpLink}
                    >
                      {t('购买兑换码')}
                    </Text>
                  </Text>
                )
              }
            />
          </Form>
        </Card>
      ) : (
        <Banner
          type='warning'
          description={t('兑换码功能已禁用，管理员需先确认合规声明。')}
          closeIcon={null}
          className='!rounded-xl'
        />
      )}
    </Space>
  );

  return (
    <Card className='!rounded-xl !shadow-none !border-semi-color-border'>
      {/* 卡片头部 - Notion / Linear 极简风 */}
      <div className='flex items-center justify-between mb-6 flex-wrap gap-3'>
        <div className='flex flex-col leading-tight'>
          <span className='text-base font-semibold tracking-tight'>
            {t('钱包管理')}
          </span>
          <span className='mt-0.5 text-xs text-semi-color-text-2'>
            {t('订阅套餐与按量额度统一管理')}
          </span>
        </div>
        <Button
          icon={<Receipt size={14} />}
          theme='borderless'
          type='tertiary'
          size='small'
          onClick={onOpenHistory}
        >
          {t('账单')}
        </Button>
      </div>

      {shouldShowSubscription ? (
        <Tabs type='card' activeKey={activeTab} onChange={setActiveTab}>
          <TabPane
            tab={
              <div className='flex items-center gap-2'>
                <Sparkles size={16} />
                {t('订阅套餐')}
              </div>
            }
            itemKey='subscription'
          >
            <div className='py-2'>
              <SubscriptionPlansCard
                t={t}
                loading={subscriptionLoading}
                plans={subscriptionPlans}
                initialPlanId={initialPlanId}
                payMethods={payMethods}
                enableOnlineTopUp={enableOnlineTopUp}
                enableStripeTopUp={enableStripeTopUp}
                enableCreemTopUp={enableCreemTopUp}
                enableAlipayNativeTopUp={enableAlipayNativeTopUp}
                billingPreference={billingPreference}
                onChangeBillingPreference={onChangeBillingPreference}
                activeSubscriptions={activeSubscriptions}
                allSubscriptions={allSubscriptions}
                reloadSubscriptionSelf={reloadSubscriptionSelf}
                withCard={false}
              />
            </div>
          </TabPane>
          <TabPane
            tab={
              <div className='flex items-center gap-2'>
                <Wallet size={16} />
                {t('按量额度')}
              </div>
            }
            itemKey='topup'
          >
            <div className='py-2'>{topupContent}</div>
          </TabPane>
        </Tabs>
      ) : (
        topupContent
      )}
    </Card>
  );
};

export default RechargeCard;
