import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Tag } from '@douyinfe/semi-ui';
import {
  CheckCircle2,
  Clipboard,
  Code2,
  GitBranch,
  KeyRound,
  PlugZap,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusContext } from '../../context/Status';
import { API, copy, showError, showSuccess } from '../../helpers';
import { theme } from './theme/design';

const TOOLS = [
  {
    id: 'claude',
    name: 'Claude Code',
    model: '兼容模型',
    description: '适合复杂项目改造、代码理解和长任务 Agent 工作流。',
    accent: '#4f46e5',
    tokenHint: '建议创建 Claude 专用分组令牌',
    configFile: {
      windows: '%USERPROFILE%\\.claude\\settings.json',
      macos: '~/.claude/settings.json',
      linux: '~/.claude/settings.json',
    },
    config: ({ apiKey, baseUrl }) => `{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "${apiKey}",
    "ANTHROPIC_BASE_URL": "${baseUrl}"
  }
}`,
    env: ({ apiKey, baseUrl }) => `ANTHROPIC_AUTH_TOKEN=${apiKey}
ANTHROPIC_BASE_URL=${baseUrl}`,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    model: '兼容模型',
    description: '适合 OpenAI 兼容代码助手、终端开发和 VS Code 扩展配置。',
    accent: '#0f766e',
    tokenHint: '建议创建 Codex 或 OpenAI 专用分组令牌',
    configFile: {
      windows: '%USERPROFILE%\\.codex\\config.toml',
      macos: '~/.codex/config.toml',
      linux: '~/.codex/config.toml',
    },
    config: ({ baseUrl, model }) => `model_provider = "coding"
model = "${model}"
model_reasoning_effort = "high"
network_access = "enabled"
disable_response_storage = true

[model_providers.coding]
name = "coding"
base_url = "${baseUrl}/v1"
wire_api = "responses"
requires_openai_auth = true`,
    env: ({ apiKey }) => `OPENAI_API_KEY=${apiKey}`,
    extraConfigFile: {
      windows: '%USERPROFILE%\\.codex\\auth.json',
      macos: '~/.codex/auth.json',
      linux: '~/.codex/auth.json',
    },
    extraConfig: ({ apiKey }) => `{
  "OPENAI_API_KEY": "${apiKey}"
}`,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    model: '兼容模型',
    description: '适合大上下文项目扫描、命令行 Agent 和多文件改造。',
    accent: '#b45309',
    tokenHint: '建议创建 Gemini 专用分组令牌',
    configFile: {
      windows: '%USERPROFILE%\\.gemini\\.env',
      macos: '~/.gemini/.env',
      linux: '~/.gemini/.env',
    },
    config: ({ apiKey, baseUrl, model }) => `GOOGLE_GEMINI_BASE_URL=${baseUrl}
GEMINI_API_KEY=${apiKey}
GEMINI_MODEL=${model}`,
    env: ({ apiKey, baseUrl, model }) => `GOOGLE_GEMINI_BASE_URL=${baseUrl}
GEMINI_API_KEY=${apiKey}
GEMINI_MODEL=${model}`,
    extraConfigFile: {
      windows: '%USERPROFILE%\\.gemini\\settings.json',
      macos: '~/.gemini/settings.json',
      linux: '~/.gemini/settings.json',
    },
    extraConfig: () => `{
  "ide": {
    "enabled": true
  },
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  }
}`,
  },
];

const PLATFORMS = [
  {
    id: 'windows',
    name: 'Windows',
    shell: 'PowerShell',
    mkdir: (path) => `New-Item -ItemType Directory -Force ${path}`,
    folder: {
      claude: '$env:USERPROFILE\\.claude',
      codex: '$env:USERPROFILE\\.codex',
      gemini: '$env:USERPROFILE\\.gemini',
    },
  },
  {
    id: 'macos',
    name: 'macOS',
    shell: 'Terminal',
    mkdir: (path) => `mkdir -p ${path}`,
    folder: {
      claude: '~/.claude',
      codex: '~/.codex',
      gemini: '~/.gemini',
    },
  },
  {
    id: 'linux',
    name: 'Linux',
    shell: 'Shell',
    mkdir: (path) => `mkdir -p ${path}`,
    folder: {
      claude: '~/.claude',
      codex: '~/.codex',
      gemini: '~/.gemini',
    },
  },
];

const MODES = [
  { id: 'file', name: '配置文件' },
  { id: 'env', name: '环境变量' },
];

const MAP_NODES = [
  {
    title: '本站端点',
    desc: '统一 Base URL',
    accent: '#2563eb',
  },
  {
    title: 'API Key',
    desc: '读取可用模型',
    accent: '#0f766e',
  },
  {
    title: '选择模型',
    desc: '按令牌权限生成配置',
    accent: '#7c3aed',
  },
];

function CodeBlock({ label, code }) {
  const { t } = useTranslation();

  const handleCopy = async () => {
    const ok = await copy(code);
    if (ok) showSuccess(t('已复制到剪切板'));
  };

  return (
    <div
      style={{
        border: '1px solid #1e293b',
        borderRadius: theme.radius.md,
        overflow: 'hidden',
        background: '#0a0f1d',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          borderBottom: '1px solid #1e293b',
          background: '#0f172a',
        }}
      >
        <span
          style={{
            color: '#94a3b8',
            fontSize: 12,
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <button
          type='button'
          onClick={handleCopy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid #334155',
            borderRadius: theme.radius.sm,
            background: '#111827',
            color: '#e2e8f0',
            padding: '5px 9px',
            fontSize: 12,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Clipboard size={13} />
          {t('复制')}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 16,
          overflowX: 'auto',
          color: '#e2e8f0',
          fontSize: 13,
          lineHeight: 1.65,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function maskApiKey(apiKey) {
  if (!apiKey) return 'sk-your-token';
  if (apiKey.length <= 12) return `${apiKey.slice(0, 4)}••••`;
  return `${apiKey.slice(0, 6)}••••${apiKey.slice(-4)}`;
}

function normalizeModelName(model) {
  const name =
    typeof model === 'string'
      ? model
      : model?.id || model?.model_name || model?.name || model?.display_name;
  return typeof name === 'string' ? name.replace(/^models\//, '') : name;
}

function normalizeModelList(data) {
  const rawModels = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : [];

  return rawModels
    .map(normalizeModelName)
    .filter(Boolean)
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b));
}

const IntegrationGuide = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [statusState] = useContext(StatusContext);
  const [activeToolId, setActiveToolId] = useState('claude');
  const [activePlatformId, setActivePlatformId] = useState('windows');
  const [mode, setMode] = useState('file');
  const [apiKey, setApiKey] = useState('');
  const [selectedModels, setSelectedModels] = useState({});
  const [systemModels, setSystemModels] = useState([]);
  const [tokenModels, setTokenModels] = useState([]);
  const [systemModelLoading, setSystemModelLoading] = useState(false);
  const [tokenModelLoading, setTokenModelLoading] = useState(false);

  const baseUrl =
    statusState?.status?.server_address ||
    (typeof window !== 'undefined'
      ? window.location.origin
      : 'https://api.example.com');

  const activeTool = useMemo(
    () => TOOLS.find((tool) => tool.id === activeToolId) || TOOLS[0],
    [activeToolId],
  );

  useEffect(() => {
    let ignore = false;
    const loadModels = async () => {
      setSystemModelLoading(true);
      try {
        const res = await API.get('/api/pricing');
        if (ignore) return;
        if (res.data?.success && Array.isArray(res.data?.data)) {
          setSystemModels(normalizeModelList(res.data.data));
        } else if (res.data?.message) {
          showError(res.data.message);
        }
      } catch (error) {
        if (!ignore) showError(error.message || t('模型列表加载失败'));
      } finally {
        if (!ignore) setSystemModelLoading(false);
      }
    };
    loadModels();
    return () => {
      ignore = true;
    };
  }, [t]);

  useEffect(() => {
    const token = apiKey.trim();
    if (!token) {
      setTokenModels([]);
      setTokenModelLoading(false);
      return undefined;
    }

    let ignore = false;
    const timer = window.setTimeout(async () => {
      setTokenModelLoading(true);
      try {
        const res = await API.get('/v1/models', {
          disableDuplicate: true,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (ignore) return;
        const names = normalizeModelList(res.data);
        setTokenModels(names);
      } catch (error) {
        if (!ignore) setTokenModels([]);
      } finally {
        if (!ignore) setTokenModelLoading(false);
      }
    }, 500);

    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [apiKey]);

  const hasTokenModels = tokenModels.length > 0;
  const toolModels = hasTokenModels ? tokenModels : systemModels;
  const modelLoading = systemModelLoading || tokenModelLoading;

  useEffect(() => {
    if (toolModels.length === 0) return;
    setSelectedModels((prev) => {
      const current = prev[activeTool.id];
      if (current && toolModels.includes(current)) return prev;
      return { ...prev, [activeTool.id]: toolModels[0] };
    });
  }, [activeTool.id, toolModels]);

  const activePlatform = useMemo(
    () =>
      PLATFORMS.find((platform) => platform.id === activePlatformId) ||
      PLATFORMS[0],
    [activePlatformId],
  );
  const selectedModel = selectedModels[activeTool.id] || toolModels[0] || '';
  const apiKeyForConfig = apiKey.trim() || 'sk-your-token';
  const generatorParams = {
    apiKey: apiKeyForConfig,
    baseUrl,
    model: selectedModel,
  };

  const configContent =
    mode === 'file'
      ? activeTool.config(generatorParams)
      : activeTool.env(generatorParams);
  const configLabel =
    mode === 'file'
      ? activeTool.configFile[activePlatform.id]
      : `${activePlatform.shell} env`;
  const folder = activePlatform.folder[activeTool.id];
  const extraConfigContent = activeTool.extraConfig?.(generatorParams);
  const generatedCommand = `# 1. 创建配置目录
${activePlatform.mkdir(folder)}

# 2. 写入配置
# ${configLabel}
${configContent}${
    mode === 'file' && extraConfigContent
      ? `

# ${activeTool.extraConfigFile[activePlatform.id]}
${extraConfigContent}`
      : ''
  }`;

  const steps = [
    {
      title: mode === 'file' ? '创建配置目录' : '准备环境变量',
      description:
        mode === 'file'
          ? `配置文件位置：${activeTool.configFile[activePlatform.id]}`
          : '适合临时测试或容器环境，长期使用建议切回配置文件。',
      code: mode === 'file' ? activePlatform.mkdir(folder) : configContent,
      icon: KeyRound,
    },
    {
      title: mode === 'file' ? '写入配置文件' : '复制环境变量',
      description:
        mode === 'file'
          ? `将右侧生成内容写入：${configLabel}`
          : '复制右侧环境变量到当前终端或你的 shell 配置文件。',
      code: configContent,
      icon: Clipboard,
    },
  ];

  return (
    <section
      id='client-guides'
      style={{
        padding: theme.layout.sectionPadding,
        background: theme.colors.background.secondary,
      }}
    >
      <div style={{ maxWidth: theme.layout.maxWidth, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 100,
              background: theme.colors.primary.light,
              color: theme.colors.primary.main,
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 16,
            }}
          >
            <Code2 size={15} />
            {t('AI 编程工具接入')}
          </div>
          <h2 style={{ ...theme.typography.h2, margin: '0 0 16px' }}>
            {t('选择工具、模型和系统，复制配置即可开始')}
          </h2>
          <p
            style={{
              ...theme.typography.subtitle,
              margin: '0 auto',
              maxWidth: 720,
            }}
          >
            {t(
              '覆盖 Claude Code、Codex CLI 与 Gemini CLI，模型列表来自当前系统配置，自动填入站点端点和本地配置路径。',
            )}
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            gap: 18,
            alignItems: 'stretch',
            marginBottom: 28,
          }}
          className='home-integration-map'
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
            }}
            className='home-integration-map-nodes'
          >
            {MAP_NODES.map((node) => (
              <div
                key={node.title}
                style={{
                  border: `1px solid ${theme.colors.border.default}`,
                  borderRadius: theme.radius.md,
                  padding: 16,
                  background: 'var(--semi-color-bg-0)',
                  boxShadow: theme.shadows.sm,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: theme.radius.md,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: node.accent,
                    background: `${node.accent}12`,
                    marginBottom: 10,
                  }}
                >
                  <GitBranch size={17} />
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    color: theme.colors.text.title,
                    marginBottom: 5,
                  }}
                >
                  {t(node.title)}
                </div>
                <div style={{ ...theme.typography.small }}>{t(node.desc)}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.colors.primary.main,
            }}
            aria-hidden='true'
          >
            <PlugZap size={24} />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
            }}
            className='home-integration-map-nodes'
          >
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                type='button'
                onClick={() => setActiveToolId(tool.id)}
                style={{
                  textAlign: 'left',
                  border:
                    tool.id === activeTool.id
                      ? `1px solid ${tool.accent}`
                      : `1px solid ${theme.colors.border.default}`,
                  borderRadius: theme.radius.md,
                  padding: 16,
                  background:
                    tool.id === activeTool.id
                      ? 'var(--semi-color-bg-0)'
                      : 'var(--semi-color-fill-0)',
                  boxShadow:
                    tool.id === activeTool.id
                      ? theme.shadows.md
                      : theme.shadows.sm,
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 800,
                      color: theme.colors.text.title,
                    }}
                  >
                    {tool.name}
                  </span>
                  {tool.id === activeTool.id && (
                    <CheckCircle2 size={17} color={tool.accent} />
                  )}
                </div>
                <div style={{ ...theme.typography.small }}>
                  {t('复制配置即可连接')}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          {TOOLS.map((tool) => {
            const active = tool.id === activeTool.id;
            return (
              <button
                key={tool.id}
                type='button'
                onClick={() => setActiveToolId(tool.id)}
                style={{
                  textAlign: 'left',
                  border: active
                    ? `1px solid ${tool.accent}`
                    : `1px solid ${theme.colors.border.default}`,
                  background: active
                    ? 'var(--semi-color-bg-0)'
                    : theme.colors.background.surface,
                  borderRadius: theme.radius.md,
                  padding: 18,
                  cursor: 'pointer',
                  boxShadow: active ? theme.shadows.md : theme.shadows.sm,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      color: theme.colors.text.title,
                      fontSize: 17,
                    }}
                  >
                    {tool.name}
                  </div>
                  {active && <CheckCircle2 size={18} color={tool.accent} />}
                </div>
                <Tag
                  color='blue'
                  style={{ borderRadius: 999, marginBottom: 10 }}
                >
                  {tool.model}
                </Tag>
                <div style={{ ...theme.typography.small, lineHeight: 1.6 }}>
                  {tool.description}
                </div>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.92fr) minmax(0, 1.08fr)',
            gap: 24,
          }}
          className='home-integration-grid'
        >
          <div
            style={{
              background: theme.colors.background.surface,
              border: `1px solid ${theme.colors.border.default}`,
              borderRadius: theme.radius.md,
              padding: 24,
              boxShadow: theme.shadows.sm,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 20,
              }}
            >
              {PLATFORMS.map((platform) => (
                <button
                  key={platform.id}
                  type='button'
                  onClick={() => setActivePlatformId(platform.id)}
                  style={{
                    border:
                      platform.id === activePlatform.id
                        ? `1px solid ${theme.colors.primary.main}`
                        : `1px solid ${theme.colors.border.default}`,
                    background:
                      platform.id === activePlatform.id
                        ? theme.colors.primary.light
                        : 'var(--semi-color-bg-0)',
                    color:
                      platform.id === activePlatform.id
                        ? theme.colors.primary.main
                        : theme.colors.text.body,
                    borderRadius: theme.radius.sm,
                    padding: '8px 12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {platform.name}
                </button>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 24,
              }}
            >
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  onClick={() => setMode(item.id)}
                  style={{
                    border:
                      item.id === mode
                        ? `1px solid ${theme.colors.text.title}`
                        : `1px solid ${theme.colors.border.default}`,
                    background:
                      item.id === mode
                        ? theme.colors.text.title
                        : 'var(--semi-color-bg-0)',
                    color:
                      item.id === mode
                        ? 'var(--semi-color-bg-0)'
                        : theme.colors.text.body,
                    borderRadius: theme.radius.sm,
                    padding: '8px 12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t(item.name)}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {steps.map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <div
                    key={step.title}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '36px minmax(0, 1fr)',
                      gap: 12,
                      padding: 14,
                      border: `1px solid ${theme.colors.border.default}`,
                      borderRadius: theme.radius.md,
                      background: 'var(--semi-color-bg-0)',
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: theme.radius.md,
                        background:
                          index === 0
                            ? theme.colors.primary.light
                            : theme.colors.background.secondary,
                        color:
                          index === 0
                            ? theme.colors.primary.main
                            : theme.colors.text.body,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <StepIcon size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            ...theme.typography.small,
                            fontWeight: 800,
                            color: theme.colors.primary.main,
                          }}
                        >
                          {index + 1}
                        </span>
                        <div
                          style={{
                            fontWeight: 800,
                            color: theme.colors.text.title,
                          }}
                        >
                          {t(step.title)}
                        </div>
                      </div>
                      <div
                        style={{ ...theme.typography.small, marginBottom: 10 }}
                      >
                        {t(step.description)}
                      </div>
                      <CodeBlock
                        label={activePlatform.shell}
                        code={step.code}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            style={{
              background: 'var(--semi-color-bg-0)',
              border: `1px solid ${theme.colors.border.default}`,
              borderRadius: theme.radius.md,
              padding: 24,
              boxShadow: theme.shadows.sm,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
                marginBottom: 18,
              }}
            >
              <div>
                <div style={{ ...theme.typography.h3, marginBottom: 8 }}>
                  {activeTool.name} {t('配置生成')}
                </div>
                <div style={{ ...theme.typography.small }}>
                  {activeTool.tokenHint}，端点使用当前站点：
                  <code>{baseUrl}</code>
                </div>
              </div>
              <Button
                theme='solid'
                type='primary'
                onClick={() => navigate('/console/token')}
              >
                {t('获取 API Key')}
              </Button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.2fr) minmax(180px, 0.8fr)',
                gap: 12,
                marginBottom: 14,
              }}
              className='home-integration-form-grid'
            >
              <div>
                <div
                  style={{
                    ...theme.typography.small,
                    fontWeight: 800,
                    marginBottom: 8,
                    color: theme.colors.text.title,
                  }}
                >
                  {t('粘贴 API Key')}
                </div>
                <Input
                  value={apiKey}
                  mode='password'
                  placeholder='sk-your-token'
                  onChange={setApiKey}
                  style={{ borderRadius: theme.radius.md }}
                />
                <div style={{ ...theme.typography.small, marginTop: 6 }}>
                  {t(
                    '仅在当前浏览器内用于生成配置和读取可用模型，不会提交到后台保存。当前预览：',
                  )}
                  <code>{maskApiKey(apiKey)}</code>
                </div>
              </div>
              <div>
                <div
                  style={{
                    ...theme.typography.small,
                    fontWeight: 800,
                    marginBottom: 8,
                    color: theme.colors.text.title,
                  }}
                >
                  {t('选择模型')}
                </div>
                <Select
                  value={selectedModel}
                  loading={modelLoading}
                  filter
                  placeholder={
                    modelLoading ? t('正在加载模型') : t('暂无可用模型')
                  }
                  onChange={(value) =>
                    setSelectedModels((prev) => ({
                      ...prev,
                      [activeTool.id]: value,
                    }))
                  }
                  style={{ width: '100%' }}
                >
                  {toolModels.map((model) => (
                    <Select.Option key={model} value={model}>
                      {model}
                    </Select.Option>
                  ))}
                </Select>
                <div style={{ ...theme.typography.small, marginTop: 6 }}>
                  {tokenModelLoading
                    ? t('正在根据 API Key 获取可用模型')
                    : hasTokenModels
                      ? t('模型来自当前 API Key 的可用范围')
                      : t('未填 API Key 时展示系统模型配置')}
                </div>
              </div>
            </div>

            <CodeBlock label={configLabel} code={configContent} />

            {mode === 'file' && activeTool.extraConfig && (
              <div style={{ marginTop: 14 }}>
                <CodeBlock
                  label={activeTool.extraConfigFile[activePlatform.id]}
                  code={extraConfigContent}
                />
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <CodeBlock
                label={t('一键复制配置流程')}
                code={generatedCommand}
              />
            </div>

            <div
              style={{
                marginTop: 18,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              {[
                {
                  title: '先创建令牌',
                  desc: '不同工具建议使用独立分组令牌，方便限额与日志排查。',
                },
                {
                  title: '只替换域名',
                  desc: 'OpenAI 兼容工具通常使用 /v1，Claude/Gemini 按对应工具配置要求填写。',
                },
                {
                  title: '重启终端',
                  desc: '配置文件或环境变量变更后，关闭并重新打开终端再使用 CLI。',
                },
              ].map((item) => (
                <div
                  key={item.title}
                  style={{
                    border: `1px solid ${theme.colors.border.default}`,
                    borderRadius: theme.radius.md,
                    padding: 14,
                    background: theme.colors.background.secondary,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      marginBottom: 6,
                      color: theme.colors.text.title,
                    }}
                  >
                    {t(item.title)}
                  </div>
                  <div style={{ ...theme.typography.small, lineHeight: 1.6 }}>
                    {t(item.desc)}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: theme.radius.md,
                background: 'var(--semi-color-warning-light-default)',
                border: '1px solid #fde68a',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <ShieldCheck
                size={18}
                color='#b45309'
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div
                style={{
                  ...theme.typography.small,
                  color: '#92400e',
                  lineHeight: 1.7,
                }}
              >
                {t(
                  '不要把 API Key 提交到 Git。建议将 .env、.claude、.codex、.gemini 等本地配置目录加入 ignore 文件，截图或求助时请先遮挡密钥。',
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default IntegrationGuide;
