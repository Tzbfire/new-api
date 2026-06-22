import React, { useState, useEffect, useContext, useMemo } from 'react';
import { API } from '../../helpers';
import { StatusContext } from '../../context/Status';
import { theme } from './theme/design';

function parseContext(tags) {
  if (!tags) return null;
  const tagText = Array.isArray(tags) ? tags.join(' ') : String(tags);
  const m = tagText.match(/(\d+\.?\d*[KMB])/i);
  return m ? m[1].toUpperCase() : null;
}

function resolveUsdRate(status) {
  const rate = Number(status?.usd_exchange_rate);
  return Number.isFinite(rate) && rate > 1 ? rate : 7.3;
}

const PricingCalculator = () => {
  const [statusState] = useContext(StatusContext);
  const [models, setModels] = useState([]);
  const [groupRatio, setGroupRatio] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState('default');
  const [selectedModelName, setSelectedModelName] = useState('');
  const [officialUSD, setOfficialUSD] = useState(10);
  const [liveUsdRate, setLiveUsdRate] = useState(null);

  const usdRate = useMemo(
    () => liveUsdRate || resolveUsdRate(statusState?.status),
    [liveUsdRate, statusState],
  );

  useEffect(() => {
    API.get('/api/exchange-rate')
      .then((res) => {
        const rate = Number(res?.data?.data?.rate);
        if (Number.isFinite(rate) && rate > 1) {
          setLiveUsdRate(rate);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    API.get('/api/pricing')
      .then((res) => {
        if (res?.data?.success) {
          const data = res.data.data || [];
          const gr = res.data.group_ratio || {};
          setModels(data);
          setGroupRatio(gr);
          const grp = Object.keys(gr)[0] || 'default';
          setSelectedGroup(grp);
          const first = data.find((m) => m.enable_groups?.includes(grp));
          if (first) setSelectedModelName(first.model_name);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => Object.keys(groupRatio), [groupRatio]);
  const groupModels = useMemo(
    () =>
      models.filter(
        (m) => m.enable_groups?.includes(selectedGroup) && m.quota_type === 0,
      ),
    [models, selectedGroup],
  );

  const selectedModel = useMemo(
    () =>
      groupModels.find((m) => m.model_name === selectedModelName) ||
      groupModels[0] ||
      null,
    [groupModels, selectedModelName],
  );

  useEffect(() => {
    if (
      groupModels.length > 0 &&
      (!selectedModel || !groupModels.includes(selectedModel))
    ) {
      setSelectedModelName(groupModels[0].model_name);
    }
  }, [groupModels]);

  const BASE_PER_M = 2;
  const curGroupRatio = groupRatio[selectedGroup] ?? 1;
  const officialPerM = selectedModel
    ? selectedModel.model_ratio * BASE_PER_M
    : 0;
  const officialPerMCNY = officialPerM * usdRate;
  const platformPerMInternal = officialPerM * curGroupRatio;
  const savingsPct =
    officialPerMCNY > 0
      ? Math.round((1 - platformPerMInternal / officialPerMCNY) * 100)
      : 0;

  const officialCNY = (officialUSD * usdRate).toFixed(2);
  const platformInternal = (officialUSD * curGroupRatio).toFixed(2);
  const savedCNY = (
    officialUSD * usdRate -
    officialUSD * curGroupRatio
  ).toFixed(2);

  if (loading || models.length === 0 || groups.length === 0) return null;

  return (
    <section
      style={{
        padding: theme.layout.sectionPadding,
        background: theme.colors.background.primary,
      }}
    >
      <div style={{ maxWidth: theme.layout.maxWidth, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div
            style={{
              display: 'inline-block',
              padding: '6px 14px',
              borderRadius: 100,
              background: theme.colors.success.bg,
              color: theme.colors.success.main,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            实时同步计算
          </div>
          <h2 style={{ ...theme.typography.h2, margin: '0 0 16px' }}>
            透明定价，无套路换算
          </h2>
          <p style={{ ...theme.typography.subtitle, margin: '0 0 24px' }}>
            全站模型倍率实时调用网关底层 API 同步，童叟无欺
          </p>
          <div
            style={{
              display: 'inline-block',
              fontFamily: 'monospace',
              fontSize: 14,
              color: theme.colors.text.body,
              padding: '8px 24px',
              background: theme.colors.background.secondary,
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.colors.border.default}`,
            }}
          >
            官方直连：$1 ≈ ¥{usdRate.toFixed(2)} · 平台内部：$1 × 分组倍率 =
            实际扣费(¥)
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 32,
          }}
        >
          {/* Configurator */}
          <div
            style={{
              background: theme.colors.background.surface,
              borderRadius: theme.radius.xl,
              padding: 32,
              border: `1px solid ${theme.colors.border.default}`,
              boxShadow: theme.shadows.sm,
            }}
          >
            <h3
              style={{
                ...theme.typography.h3,
                margin: '0 0 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 20 }}>1.</span> 选择引擎组与模型
            </h3>

            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  ...theme.typography.small,
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                选择引擎分组
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {groups.map((g) => {
                  const isActive = g === selectedGroup;
                  return (
                    <button
                      key={g}
                      onClick={() => setSelectedGroup(g)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: theme.radius.sm,
                        border: isActive
                          ? `1px solid ${theme.colors.primary.main}`
                          : `1px solid ${theme.colors.border.default}`,
                        background: isActive
                          ? theme.colors.primary.light
                          : theme.colors.background.primary,
                        color: isActive
                          ? theme.colors.primary.main
                          : theme.colors.text.body,
                        fontWeight: isActive ? 600 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {g}
                      <span
                        style={{
                          padding: '2px 6px',
                          background: isActive
                            ? theme.colors.primary.main
                            : theme.colors.background.secondary,
                          color: isActive ? '#fff' : theme.colors.text.muted,
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                      >
                        {groupRatio[g]}x
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div
                style={{
                  ...theme.typography.small,
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                选择路由模型
              </div>
              <select
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: theme.radius.md,
                  border: `1px solid ${theme.colors.border.default}`,
                  fontSize: 15,
                  background: theme.colors.background.primary,
                  outline: 'none',
                  cursor: 'pointer',
                  color: theme.colors.text.title,
                }}
                value={selectedModel?.model_name || ''}
                onChange={(e) => setSelectedModelName(e.target.value)}
              >
                {groupModels.map((m) => (
                  <option key={m.model_name} value={m.model_name}>
                    {m.model_name}{' '}
                    {parseContext(m.tags) ? `  — ${parseContext(m.tags)}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedModel && (
              <div
                style={{
                  marginTop: 32,
                  padding: 20,
                  background: theme.colors.background.secondary,
                  borderRadius: theme.radius.lg,
                  border: `1px solid ${theme.colors.border.default}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <span style={theme.typography.small}>官方直连价格</span>
                  <span
                    style={{
                      ...theme.typography.body,
                      fontFamily: 'monospace',
                    }}
                  >
                    ${officialPerM.toFixed(4)} / 1M tokens
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <span style={theme.typography.small}>
                    直连折合人民币 (汇率 ¥{usdRate.toFixed(2)})
                  </span>
                  <span
                    style={{
                      ...theme.typography.body,
                      fontFamily: 'monospace',
                      textDecoration: 'line-through',
                      opacity: 0.65,
                    }}
                  >
                    ¥{officialPerMCNY.toFixed(4)} / 1M tokens
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      ...theme.typography.small,
                      fontWeight: 600,
                      color: theme.colors.primary.main,
                    }}
                  >
                    平台折后价 ({selectedGroup})
                  </span>
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: theme.colors.primary.main,
                      fontFamily: 'monospace',
                    }}
                  >
                    ¥{platformPerMInternal.toFixed(4)}{' '}
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      / 1M tokens
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    height: 1,
                    background: theme.colors.border.default,
                    margin: '16px 0',
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={theme.typography.small}>相较官方为您节省</span>
                  <span
                    style={{
                      color: theme.colors.success.main,
                      fontWeight: 700,
                      background: theme.colors.success.bg,
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  >
                    约 {savingsPct}%
                  </span>
                </div>
                <div
                  style={{
                    ...theme.typography.small,
                    color: theme.colors.text.muted,
                    marginTop: 10,
                  }}
                >
                  例如官方 $1 折合约 ¥{usdRate.toFixed(2)}，{selectedGroup} 分组{' '}
                  {curGroupRatio}x 时平台约扣 ¥{curGroupRatio.toFixed(2)}。
                </div>
              </div>
            )}
          </div>

          {/* Simulator */}
          <div
            style={{
              background: theme.colors.background.surface,
              borderRadius: theme.radius.xl,
              padding: 32,
              border: `1px solid ${theme.colors.border.default}`,
              boxShadow: theme.shadows.sm,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <h3
              style={{
                ...theme.typography.h3,
                margin: '0 0 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 20 }}>2.</span> 对比计算器
            </h3>
            <p style={{ ...theme.typography.small, margin: '0 0 24px' }}>
              输入您过去在官方 API
              的大体消耗金额，实时对比在强力网关产生的实际开销。
            </p>

            <div style={{ marginBottom: 32 }}>
              <div
                style={{
                  ...theme.typography.small,
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                假设官直连等额调用花费
              </div>
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 16,
                    fontSize: 18,
                    color: theme.colors.text.muted,
                    fontWeight: 500,
                  }}
                >
                  $
                </span>
                <input
                  type='number'
                  min='1'
                  max='100000'
                  value={officialUSD}
                  onChange={(e) =>
                    setOfficialUSD(Math.max(1, Number(e.target.value) || 1))
                  }
                  style={{
                    width: '100%',
                    padding: '16px 16px 16px 36px',
                    borderRadius: theme.radius.md,
                    border: `1px solid ${theme.colors.border.default}`,
                    fontSize: 20,
                    fontWeight: 700,
                    color: theme.colors.text.title,
                    background: theme.colors.background.primary,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16,
                }}
              >
                <span style={theme.typography.body}>
                  直连实际需要 (汇率 ¥{usdRate.toFixed(2)})
                </span>
                <span
                  style={{
                    ...theme.typography.body,
                    fontFamily: 'monospace',
                    textDecoration: 'line-through',
                    opacity: 0.6,
                  }}
                >
                  ¥ {officialCNY}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    ...theme.typography.body,
                    fontWeight: 600,
                    color: theme.colors.primary.main,
                  }}
                >
                  平台实际扣费 ({selectedGroup})
                </span>
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: theme.colors.primary.main,
                    fontFamily: 'monospace',
                  }}
                >
                  ¥ {platformInternal}
                </span>
              </div>
            </div>

            <div
              style={{
                marginTop: 'auto',
                background: theme.colors.primary.main,
                padding: 24,
                borderRadius: theme.radius.lg,
                color: '#fff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 10px 15px -3px rgba(79,70,229,0.3)',
              }}
            >
              <div>
                <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>
                  本次可为您省下
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    fontFamily: 'monospace',
                  }}
                >
                  ¥ {savedCNY}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>
                  对比直接向官方采买
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  降低 {savingsPct}% 成本
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PricingCalculator;
