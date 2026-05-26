import React from 'react';
import { theme } from './theme/design';
import { Button } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';

export const CopyButton = ({ text, style }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        color: copied ? theme.colors.success.main : theme.colors.primary.main,
        ...style,
      }}
    >
      {copied ? '✅' : '📋'}
    </button>
  );
};

const Hero = () => {
  const navigate = useNavigate();
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://api.example.com';
  const curlExample = `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-token" \\
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'`;
  const highlights = [
    { label: 'OpenAI SDK 兼容', desc: '现有客户端只需替换 base_url' },
    {
      label: '多模型统一路由',
      desc: '一个 Key 访问 OpenAI、Claude、Gemini 等',
    },
    { label: '按量透明计费', desc: '统一账单，模型倍率实时可查' },
    { label: '调用日志可追踪', desc: '请求、扣费和错误链路清晰可见' },
  ];

  const trustBadges = ['¥1 起充', '按量扣费', '支持订阅套餐', '调用日志可查'];

  return (
    <section
      style={{
        position: 'relative',
        padding: '120px 24px 80px',
        background:
          'linear-gradient(180deg, var(--semi-color-bg-1) 0%, var(--semi-color-bg-0) 100%)',
        overflow: 'hidden',
        borderBottom: `1px solid ${theme.colors.border.default}`,
      }}
    >
      <div
        style={{
          maxWidth: theme.layout.maxWidth,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            background: theme.colors.primary.light,
            borderRadius: 100,
            border: `1px solid ${theme.colors.primary.main}30`,
            marginBottom: 32,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: theme.colors.primary.main,
            }}
          />
          <span
            style={{
              ...theme.typography.small,
              color: theme.colors.primary.main,
              fontWeight: 600,
            }}
          >
            兼容 OpenAI SDK 的多模型网关
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            ...theme.typography.h1,
            maxWidth: 900,
            marginBottom: 24,
            letterSpacing: 0,
            lineHeight: 1.2,
          }}
        >
          一个 API Key <br />
          <span style={{ color: theme.colors.primary.main }}>
            接入主流 AI 模型
          </span>
        </h1>

        {/* Subtitle */}
        <p
          style={{
            ...theme.typography.subtitle,
            maxWidth: 680,
            marginBottom: 48,
            fontSize: 20,
          }}
        >
          兼容 OpenAI 调用方式，一个 API Key 接入 Claude、GPT、Gemini、DeepSeek、Qwen
          等模型。支持小额充值、按量扣费和调用日志追踪，适合 AI 编程工具与业务原型快速接入。
        </p>

        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginTop: -24,
            marginBottom: 40,
          }}
        >
          {trustBadges.map((item) => (
            <span
              key={item}
              style={{
                ...theme.typography.small,
                color: theme.colors.text.body,
                background: theme.colors.background.secondary,
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: 100,
                padding: '6px 12px',
                fontWeight: 700,
              }}
            >
              {item}
            </span>
          ))}
        </div>

        {/* CTAs */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <Button
            theme='solid'
            size='large'
            onClick={() => navigate('/register')}
            style={{
              padding: '16px 36px',
              fontSize: 18,
              fontWeight: 600,
              borderRadius: theme.radius.md,
              background: theme.colors.primary.main,
              boxShadow: '0 8px 20px -6px rgba(79, 70, 229, 0.4)',
            }}
          >
            免费注册，领取 API Key
          </Button>
          <Button
            theme='light'
            size='large'
            onClick={() =>
              document
                .getElementById('first-recharge')
                ?.scrollIntoView({ behavior: 'smooth' })
            }
            style={{
              padding: '16px 36px',
              fontSize: 18,
              fontWeight: 600,
              borderRadius: theme.radius.md,
              background: 'var(--semi-color-bg-0)',
              color: theme.colors.text.title,
              border: `1px solid ${theme.colors.border.default}`,
              boxShadow: theme.shadows.sm,
            }}
          >
            查看充值套餐
          </Button>
        </div>
        <button
          type='button'
          onClick={() =>
            document
              .getElementById('client-guides')
              ?.scrollIntoView({ behavior: 'smooth' })
          }
          style={{
            marginTop: 0,
            border: 'none',
            background: 'transparent',
            color: theme.colors.primary.main,
            fontWeight: 700,
            cursor: 'pointer',
            padding: '8px 10px',
          }}
        >
          查看 Claude Code / Codex CLI 插件接入示例
        </button>

        <div
          style={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 16,
            marginTop: 48,
          }}
        >
          {highlights.map((item) => (
            <div
              key={item.label}
              style={{
                textAlign: 'left',
                background: 'var(--semi-color-bg-0)',
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: theme.radius.lg,
                padding: 20,
                boxShadow: theme.shadows.sm,
              }}
            >
              <div
                style={{
                  ...theme.typography.body,
                  color: theme.colors.text.title,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {item.label}
              </div>
              <div style={{ ...theme.typography.small, lineHeight: 1.6 }}>
                {item.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Hero;
