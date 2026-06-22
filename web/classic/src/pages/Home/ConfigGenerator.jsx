import React, { useState } from 'react';
import { theme } from './theme/design';
import { CopyButton } from './Hero';

const languages = [
  { id: 'curl', name: 'cURL', syntax: 'bash' },
  { id: 'python', name: 'Python', syntax: 'python' },
  { id: 'js', name: 'Node.js', syntax: 'javascript' },
  { id: 'go', name: 'Go', syntax: 'go' },
];

const ConfigGenerator = () => {
  const [activeLang, setActiveLang] = useState('curl');

  // Try to use the active host or a fallback
  const baseUrl =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://api.example.com';

  const snippets = {
    curl: `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-token" \\
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'`,
    python: `import os
from openai import OpenAI

client = OpenAI(
    api_key="sk-your-token",
    base_url="${baseUrl}/v1"
)

response = client.chat.completions.create(
    model="gpt-5.5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)`,
    js: `import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "sk-your-token",
  baseURL: "${baseUrl}/v1"
});

async function main() {
  const completion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" }
    ],
    model: "gpt-5.5",
  });

  console.log(completion.choices[0].message.content);
}
main();`,
    go: `package main

import (
    "context"
    "fmt"
    "github.com/sashabaranov/go-openai"
)

func main() {
    config := openai.DefaultConfig("sk-your-token")
    config.BaseURL = "${baseUrl}/v1"

    client := openai.NewClientWithConfig(config)
    resp, err := client.CreateChatCompletion(
        context.Background(),
        openai.ChatCompletionRequest{
            Model: "gpt-5.5",
            Messages: []openai.ChatCompletionMessage{
                {Role: "system", Content: "You are a helpful assistant."},
                {Role: "user", Content: "Hello!"},
            },
        },
    )

    if err != nil {
        fmt.Printf("ChatCompletion error: %v\\n", err)
        return
    }

    fmt.Println(resp.Choices[0].Message.Content)
}`,
  };

  return (
    <section
      style={{
        padding: theme.layout.sectionPadding,
        background: theme.colors.background.primary,
      }}
    >
      <div style={{ maxWidth: theme.layout.maxWidth, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 64,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: '1 1 400px', minWidth: 300 }}>
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
              开发者优先
            </div>
            <h2 style={{ ...theme.typography.h2, margin: '0 0 16px' }}>
              只需修改两行代码
            </h2>
            <p style={{ ...theme.typography.subtitle, margin: '0 0 32px' }}>
              平滑迁移到我们的 API 网关：无需更改使用习惯，只需将{' '}
              <code>base_url</code> 替换并在 <code>api_key</code>{' '}
              中填入平台的令牌。
            </p>

            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '0 0 32px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {[
                {
                  title: '完全兼容 OpenAI SDK',
                  desc: '100% 遵守原版调用参数及流式输出。',
                },
                {
                  title: '无缝接入第三方生态',
                  desc: '支持各类流行基于 OpenAI 接口封装的社区客户端与产品。',
                },
                {
                  title: '内网调用低延迟',
                  desc: '利用全球多节点分布式边缘接入计算网络。',
                },
              ].map((item, i) => (
                <li
                  key={i}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radius.md,
                      background: theme.colors.background.secondary,
                      border: `1px solid ${theme.colors.border.default}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: theme.colors.primary.main,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>🚀</span>
                  </div>
                  <div>
                    <div
                      style={{
                        ...theme.typography.body,
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        ...theme.typography.small,
                        color: theme.colors.text.muted,
                      }}
                    >
                      {item.desc}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div
            style={{
              flex: '1 1 450px',
              minWidth: 300,
              background: '#0a0f1d',
              borderRadius: theme.radius.xl,
              border: '1px solid #1e293b',
              boxShadow: theme.shadows.lg,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: '#0f172a',
                borderBottom: '1px solid #1e293b',
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                {languages.map((lang) => (
                  <button
                    key={lang.id}
                    onClick={() => setActiveLang(lang.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: theme.radius.sm,
                      border: 'none',
                      background:
                        activeLang === lang.id ? '#1e293b' : 'transparent',
                      color: activeLang === lang.id ? '#e2e8f0' : '#64748b',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontFamily: 'monospace',
                    }}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#ef4444',
                  }}
                ></div>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#eab308',
                  }}
                ></div>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#22c55e',
                  }}
                ></div>
              </div>
            </div>

            <div style={{ padding: 24, position: 'relative' }}>
              <pre
                style={{
                  margin: 0,
                  padding: 0,
                  background: 'transparent',
                  color: '#e2e8f0',
                  fontSize: 14,
                  fontFamily: 'monospace',
                  lineHeight: 1.6,
                  overflowX: 'auto',
                }}
              >
                <code>{snippets[activeLang]}</code>
              </pre>

              {/* Visual marker highlighting the baseURL replacement */}
              {(activeLang === 'python' || activeLang === 'js') && (
                <div
                  style={{
                    position: 'absolute',
                    left: 24,
                    top: activeLang === 'python' ? 104 : 100,
                    width: 'calc(100% - 48px)',
                    height: 24,
                    background: 'rgba(79, 70, 229, 0.2)',
                    border: '1px solid rgba(79, 70, 229, 0.5)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                  }}
                />
              )}
              {activeLang === 'go' && (
                <div
                  style={{
                    position: 'absolute',
                    left: 24,
                    top: 178,
                    width: 'calc(100% - 48px)',
                    height: 24,
                    background: 'rgba(79, 70, 229, 0.2)',
                    border: '1px solid rgba(79, 70, 229, 0.5)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                  }}
                />
              )}
              {activeLang === 'curl' && (
                <div
                  style={{
                    position: 'absolute',
                    left: 24,
                    top: 24,
                    width: 'calc(100% - 48px)',
                    height: 24,
                    background: 'rgba(79, 70, 229, 0.2)',
                    border: '1px solid rgba(79, 70, 229, 0.5)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ConfigGenerator;
