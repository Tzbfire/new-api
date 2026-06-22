export function formatSubscriptionDuration(plan, t) {
  const unit = plan?.duration_unit || 'month';
  const value = plan?.duration_value || 1;
  const unitLabels = {
    year: t('年'),
    month: t('个月'),
    day: t('天'),
    hour: t('小时'),
    custom: t('自定义'),
  };
  if (unit === 'custom') {
    const seconds = plan?.custom_seconds || 0;
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('天')}`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('小时')}`;
    return `${seconds} ${t('秒')}`;
  }
  return `${value} ${unitLabels[unit] || unit}`;
}

export function formatSubscriptionResetPeriod(plan, t) {
  const period = plan?.quota_reset_period || 'never';
  if (period === 'never') return t('不重置');
  if (period === 'daily') return t('每天');
  if (period === 'weekly') return t('每周');
  if (period === 'monthly') return t('每月');
  if (period === 'custom') {
    const seconds = Number(plan?.quota_reset_custom_seconds || 0);
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('天')}`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('小时')}`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)} ${t('分钟')}`;
    return `${seconds} ${t('秒')}`;
  }
  return t('不重置');
}

function getDurationSeconds(plan) {
  const unit = plan?.duration_unit || 'month';
  const value = Number(plan?.duration_value || 0);
  if (unit === 'day') return value * 86400;
  if (unit === 'hour') return value * 3600;
  if (unit === 'custom') return Number(plan?.custom_seconds || 0);
  return 0;
}

function getResetSeconds(plan) {
  const period = plan?.quota_reset_period || 'never';
  if (period === 'daily') return 86400;
  if (period === 'custom') return Number(plan?.quota_reset_custom_seconds || 0);
  return 0;
}

export function formatSubscriptionAllowedGroups(plan, t) {
  const groups = String(plan?.allowed_token_groups || '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);
  if (groups.length === 0) {
    return {
      hasRestriction: false,
      label: `${t('可用分组')}: ${t('不限分组')}`,
      value: t('不限分组'),
      groups: [],
    };
  }
  return {
    hasRestriction: true,
    label: `${t('可用分组')}: ${groups.join(', ')}`,
    value: groups.join(', '),
    groups,
  };
}

export function getSubscriptionQuotaSummary(plan, t, renderQuota) {
  const totalAmount = Number(plan?.total_amount || 0);
  const resetPeriod = plan?.quota_reset_period || 'never';
  if (totalAmount <= 0) {
    return {
      primaryLabel: `${t('额度')}: ${t('不限')}`,
      secondaryLabel: null,
      tooltip: null,
    };
  }

  if (resetPeriod === 'never') {
    return {
      primaryLabel: `${t('总额度')}: ${renderQuota(totalAmount)}`,
      secondaryLabel: null,
      tooltip: `${t('原生额度')}：${totalAmount}`,
    };
  }

  const periodLabelMap = {
    daily: t('每日可用'),
    weekly: t('每周可用'),
    monthly: t('每月可用'),
    custom: t('每次重置可用'),
  };
  const primaryLabel = `${periodLabelMap[resetPeriod] || t('每周期可用')}: ${renderQuota(totalAmount)}`;

  const durationSeconds = getDurationSeconds(plan);
  const resetSeconds = getResetSeconds(plan);
  if (durationSeconds > 0 && resetSeconds > 0 && durationSeconds % resetSeconds === 0) {
    const cycles = Math.floor(durationSeconds / resetSeconds);
    if (cycles > 0) {
      return {
        primaryLabel,
        secondaryLabel: `${t('理论总权益')}: ${renderQuota(totalAmount * cycles)}`,
        tooltip: `${t('原生额度')}：${totalAmount} × ${cycles}`,
      };
    }
  }

  return {
    primaryLabel,
    secondaryLabel: null,
    tooltip: `${t('原生额度')}：${totalAmount}`,
  };
}
