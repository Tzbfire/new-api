import React, { useEffect, useMemo, useState } from 'react';
import { Button, Spin } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { API, renderQuota } from '../../helpers';
import { theme } from './theme/design';

const formatCurrency = (amount, currency = 'CNY') => {
  const symbol = currency?.toUpperCase() === 'USD' ? '$' : '¥';
  const value = Number(amount || 0);
  return `${symbol}${Number.isInteger(value) ? value : value.toFixed(2)}`;
};

const formatDuration = (value, unit) => {
  if (!value || !unit) return '按套餐周期';
  const unitMap = {
    day: '天',
    days: '天',
    week: '周',
    weeks: '周',
    month: '月',
    months: '月',
    year: '年',
    years: '年',
  };
  return `${value}${unitMap[unit] || unit}`;
};

const fallbackUsageCards = [
  {
    title: '首充体验',
    amount: '¥1 起充',
    topupAmount: 1,
    desc: '适合先跑通 API Key、模型路由和扣费日志。',
    features: ['小额验证', 'OpenAI SDK 兼容', '请求与扣费可追踪'],
    action: '首充体验',
  },
  {
    title: '开发者推荐',
    amount: '¥50 推荐',
    topupAmount: 50,
    desc: '适合 Claude Code、Codex CLI、机器人和业务原型的日常调用。',
    features: ['统一模型入口', '分组倍率透明', '适合持续开发调用'],
    featured: true,
    action: '推荐充值 ¥50',
  },
  {
    title: '团队高频',
    amount: '¥1000+',
    topupAmount: 1000,
    desc: '适合多人协作、稳定生产调用和财务对账。',
    features: ['团队额度管理', '高频调用场景', '专属支持与发票'],
    action: '开通团队额度',
  },
];

const valuePoints = [
  '充值后立即可用：创建 Key 后可直接调用',
  '按量扣费：不用订阅也能先小额测试',
  '明细可查：每次请求、模型和扣费都有日志',
];

const tabItems = [
  { key: 'topup', label: '额度充值' },
  { key: 'plans', label: '订阅套餐' },
];

const PricingAndTutorial = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('topup');

  useEffect(() => {
    API.get('/api/subscription/public-plans')
      .then((res) => {
        if (res?.data?.success && Array.isArray(res.data.data)) {
          setPlans(res.data.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hasPlans = plans.length > 0;

  const planCards = useMemo(() => {
    return plans.map((plan, index) => ({
      id: plan.id,
      title: plan.title || `订阅套餐 ${index + 1}`,
      amount: formatCurrency(plan.price_amount, plan.currency),
      desc: plan.subtitle || '后台已启用的真实订阅套餐。',
      period: formatDuration(plan.duration_value, plan.duration_unit),
      quota: plan.total_amount
        ? `${renderQuota(plan.total_amount)}`
        : '额度按后台配置',
      reset: plan.quota_reset_period
        ? `重置周期：${plan.quota_reset_period}`
        : '按套餐规则生效',
      group: plan.upgrade_group
        ? `升级分组：${plan.upgrade_group}`
        : '默认用户分组',
      featured: index === 0,
    }));
  }, [plans]);

  const goToTopup = (planId, topupAmount) => {
    const amountQuery = topupAmount ? `&amount=${topupAmount}` : '';
    const redirect = planId
      ? `/console/topup?tab=subscription&plan_id=${planId}`
      : `/console/topup?tab=topup${amountQuery}&checkout=1`;
    if (localStorage.getItem('user')) {
      navigate(redirect);
      return;
    }
    navigate(`/login?redirect=${encodeURIComponent(redirect)}`);
  };

  return (
    <section
      id='first-recharge'
      style={{
        padding: theme.layout.sectionPadding,
        background: theme.colors.background.secondary,
      }}
    >
      <div style={{ maxWidth: theme.layout.maxWidth, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div
            style={{
              display: 'inline-block',
              padding: '6px 14px',
              borderRadius: 100,
              background: theme.colors.primary.light,
              color: theme.colors.primary.main,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            透明计费 · 充值即用
          </div>
          <h2 style={{ ...theme.typography.h2, margin: '0 0 16px' }}>
            新用户先小额验证，跑通后再升级套餐
          </h2>
          <p
            style={{
              ...theme.typography.subtitle,
              maxWidth: 720,
              margin: '0 auto',
            }}
          >
            不确定用量时先充值体验；高频调用时选择每日额度套餐，成本更稳定。
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
              marginTop: 28,
            }}
          >
            {valuePoints.map((item) => (
              <div
                key={item}
                style={{
                  ...theme.typography.small,
                  color: theme.colors.text.body,
                  background: theme.colors.background.surface,
                  border: `1px solid ${theme.colors.border.default}`,
                  borderRadius: theme.radius.md,
                  padding: '12px 14px',
                  textAlign: 'left',
                  fontWeight: 650,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              padding: 4,
              background: 'var(--semi-color-fill-0)',
              border: `1px solid ${theme.colors.border.default}`,
              borderRadius: theme.radius.md,
            }}
          >
            {tabItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type='button'
                  onClick={() => setActiveTab(item.key)}
                  style={{
                    border: 'none',
                    borderRadius: theme.radius.sm,
                    padding: '10px 22px',
                    background: isActive
                      ? theme.colors.primary.main
                      : 'transparent',
                    color: isActive
                      ? 'var(--semi-color-white)'
                      : theme.colors.text.body,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <Spin spinning={loading}>
          {activeTab === 'topup' ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 24,
              }}
            >
              {fallbackUsageCards.map((card) => (
                <div
                  key={card.title}
                  style={{
                    background: theme.colors.background.surface,
                    padding: 32,
                    borderRadius: theme.radius.xl,
                    border: card.featured
                      ? `2px solid ${theme.colors.primary.main}`
                      : `1px solid ${theme.colors.border.default}`,
                    boxShadow: card.featured
                      ? theme.shadows.lg
                      : theme.shadows.sm,
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                  }}
                >
                  {card.featured && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -14,
                        left: 24,
                        background: theme.colors.primary.main,
                        color: '#fff',
                        padding: '4px 14px',
                        borderRadius: 100,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      推荐
                    </div>
                  )}
                  <div
                    style={{
                      ...theme.typography.small,
                      fontWeight: 700,
                      color: card.featured
                        ? theme.colors.primary.main
                        : theme.colors.text.muted,
                      marginBottom: 14,
                    }}
                  >
                    {card.title}
                  </div>
                  <div
                    style={{
                      fontSize: 34,
                      fontWeight: 800,
                      color: theme.colors.text.title,
                      marginBottom: 10,
                      fontFamily: 'monospace',
                    }}
                  >
                    {card.amount}
                  </div>
                  <p
                    style={{
                      ...theme.typography.body,
                      color: theme.colors.text.muted,
                      margin: '0 0 24px',
                    }}
                  >
                    {card.desc}
                  </p>

                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: '0 0 28px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      flex: 1,
                    }}
                  >
                    {card.features.map((item) => (
                      <li
                        key={item}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          ...theme.typography.body,
                        }}
                      >
                        <span
                          style={{
                            color: theme.colors.primary.main,
                            fontWeight: 800,
                          }}
                        >
                          ✓
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>

                  <Button
                    theme='solid'
                    onClick={() => goToTopup(null, card.topupAmount)}
                    style={{
                      background: card.featured
                        ? theme.colors.primary.main
                        : theme.colors.text.title,
                      color: card.featured ? 'var(--semi-color-white)' : 'var(--semi-color-bg-0)',
                      width: '100%',
                      height: 48,
                      borderRadius: theme.radius.md,
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    {card.action || '充值并开始使用'}
                  </Button>
                </div>
              ))}
            </div>
          ) : hasPlans ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 24,
              }}
            >
              {planCards.map((card) => (
                <div
                  key={card.id || card.title}
                  style={{
                    background: theme.colors.background.surface,
                    padding: 32,
                    borderRadius: theme.radius.xl,
                    border: card.featured
                      ? `2px solid ${theme.colors.primary.main}`
                      : `1px solid ${theme.colors.border.default}`,
                    boxShadow: card.featured
                      ? theme.shadows.lg
                      : theme.shadows.sm,
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                  }}
                >
                  {card.featured && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -14,
                        left: 24,
                        background: theme.colors.primary.main,
                        color: '#fff',
                        padding: '4px 14px',
                        borderRadius: 100,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      推荐
                    </div>
                  )}
                  <div
                    style={{
                      ...theme.typography.small,
                      fontWeight: 700,
                      color: card.featured
                        ? theme.colors.primary.main
                        : theme.colors.text.muted,
                      marginBottom: 14,
                    }}
                  >
                    {card.title}
                  </div>
                  <div
                    style={{
                      fontSize: 34,
                      fontWeight: 800,
                      color: theme.colors.text.title,
                      marginBottom: 10,
                      fontFamily: 'monospace',
                    }}
                  >
                    {card.amount}
                  </div>
                  <p
                    style={{
                      ...theme.typography.body,
                      color: theme.colors.text.muted,
                      margin: '0 0 24px',
                    }}
                  >
                    {card.desc}
                  </p>

                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: '0 0 28px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      flex: 1,
                    }}
                  >
                    {(
                      card.features || [
                        card.period,
                        card.quota,
                        card.reset,
                        card.group,
                      ]
                    )
                      .filter(Boolean)
                      .map((item) => (
                        <li
                          key={item}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            ...theme.typography.body,
                          }}
                        >
                          <span
                            style={{
                              color: theme.colors.primary.main,
                              fontWeight: 800,
                            }}
                          >
                            ✓
                          </span>
                          {item}
                        </li>
                      ))}
                  </ul>

                  <Button
                    theme='solid'
                    onClick={() => goToTopup(card.id)}
                    style={{
                      background: card.featured
                        ? theme.colors.primary.main
                        : theme.colors.text.title,
                      color: card.featured ? 'var(--semi-color-white)' : 'var(--semi-color-bg-0)',
                      width: '100%',
                      height: 48,
                      borderRadius: theme.radius.md,
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    选择此套餐
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: 40,
                background: theme.colors.background.surface,
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: theme.radius.xl,
                color: theme.colors.text.muted,
              }}
            >
              暂未配置订阅套餐，请先使用额度充值。
            </div>
          )}
        </Spin>
      </div>
    </section>
  );
};

export default PricingAndTutorial;
