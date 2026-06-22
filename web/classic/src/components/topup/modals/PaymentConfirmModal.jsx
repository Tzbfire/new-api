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
import { SiAlipay, SiWechat, SiStripe } from 'react-icons/si';
import { CreditCard, Loader2, X } from 'lucide-react';

const PaymentConfirmModal = ({
  t,
  open,
  onlineTopUp,
  handleCancel,
  confirmLoading,
  topUpCount,
  renderQuotaWithAmount,
  amountLoading,
  renderAmount,
  payWay,
  onPayWayChange,
  payMethods,
  // 新增：用于显示折扣明细
  amountNumber,
  discountRate,
}) => {
  const hasDiscount =
    discountRate && discountRate > 0 && discountRate < 1 && amountNumber > 0;
  const originalAmount = hasDiscount ? amountNumber / discountRate : 0;
  const discountAmount = hasDiscount ? originalAmount - amountNumber : 0;
  const renderPayMethodIcon = (payMethod, size = 16) => {
    if (!payMethod) return null;
    if (payMethod.type === 'alipay' || payMethod.type === 'alipay_native' || payMethod.type === 'alipay_qr') {
      return <SiAlipay size={size} color='#1677FF' />;
    }
    if (payMethod.type === 'wxpay') {
      return <SiWechat size={size} color='#07C160' />;
    }
    if (payMethod.type === 'stripe') {
      return <SiStripe size={size} color='#635BFF' />;
    }
    if (payMethod.icon) {
      return (
        <img
          src={payMethod.icon}
          alt={payMethod.name}
          style={{ width: size, height: size, objectFit: 'contain' }}
        />
      );
    }
    return (
      <CreditCard
        size={size}
        color={payMethod.color || 'var(--semi-color-text-2)'}
      />
    );
  };

  const canSwitchPayWay = !confirmLoading && !amountLoading;

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 px-4'>
      <div className='w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-slate-900'>
        <div className='flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800'>
          <div className='flex items-center text-base font-semibold text-slate-900 dark:text-slate-100'>
            <CreditCard className='mr-2' size={18} />
            {t('确认购买额度')}
          </div>
          <button
            type='button'
            onClick={handleCancel}
            disabled={confirmLoading}
            className='rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-slate-800 dark:hover:text-slate-100'
          >
            <X size={18} />
          </button>
        </div>

        <div className='px-5 py-5'>
          <div className='rounded-xl bg-slate-50 p-4 dark:bg-slate-800'>
            <div className='flex min-h-8 items-center justify-between'>
              <span className='font-semibold text-slate-700 dark:text-slate-200'>
                {t('预计到账')}：
              </span>
              <span className='text-slate-900 dark:text-slate-100'>
                {renderQuotaWithAmount(topUpCount)}
              </span>
            </div>
            <div className='flex min-h-8 items-center justify-between'>
              <span className='font-semibold text-slate-700 dark:text-slate-200'>
                {t('预计支付')}：
              </span>
              {amountLoading ? (
                <span className='h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700' />
              ) : (
                <div className='flex items-baseline space-x-2'>
                  <span className='font-bold text-red-600'>
                    {renderAmount()}
                  </span>
                  {hasDiscount && (
                    <span className='text-xs text-rose-500'>
                      {Math.round(discountRate * 100)}%
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className='min-h-[56px] space-y-2 pt-2'>
              {hasDiscount && !amountLoading && (
                <>
                  <div className='flex items-center justify-between'>
                    <span className='text-slate-500 dark:text-slate-400'>
                    {t('原价')}：
                    </span>
                    <span className='text-slate-500 line-through dark:text-slate-400'>
                    {`${originalAmount.toFixed(2)} ${t('元')}`}
                    </span>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='text-slate-500 dark:text-slate-400'>
                    {t('优惠')}：
                    </span>
                    <span className='text-emerald-600 dark:text-emerald-400'>
                    {`- ${discountAmount.toFixed(2)} ${t('元')}`}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className='space-y-2'>
              <div className='font-semibold text-slate-700 dark:text-slate-200'>
                {t('付款方式')}
              </div>
              <div className='grid grid-cols-2 gap-2'>
                {(payMethods || []).map((method) => {
                  const isActive = method.type === payWay;
                  return (
                    <button
                      key={method.type}
                      type='button'
                      onClick={() => canSwitchPayWay && onPayWayChange?.(method.type)}
                      disabled={!canSwitchPayWay}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                        isActive
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                      } ${!canSwitchPayWay ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                    >
                      <span className='flex h-6 w-6 shrink-0 items-center justify-center'>
                        {renderPayMethodIcon(method, 18)}
                      </span>
                      <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                        {method.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className='mt-5 flex justify-end gap-3'>
            <button
              type='button'
              onClick={handleCancel}
              disabled={confirmLoading}
              className='rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
            >
              {t('取消')}
            </button>
            <button
              type='button'
              onClick={onlineTopUp}
              disabled={confirmLoading || amountLoading}
              className='inline-flex min-w-24 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70'
            >
              {confirmLoading && <Loader2 className='mr-2 animate-spin' size={16} />}
              {t('确认付款')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentConfirmModal;
