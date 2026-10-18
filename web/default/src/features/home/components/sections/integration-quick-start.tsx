/*
Copyright (C) 2023-2026 QuantumNous

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
import {
  Check,
  CheckCircle2,
  Code2,
  Copy,
  type LucideIcon,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type ToolID = 'claude' | 'codex' | 'gemini'
type PlatformID = 'windows' | 'macos' | 'linux'

type ToolConfig = {
  label: string
  description: string
  icon: LucideIcon
  paths: Record<PlatformID, string>
  snippet: string
}

const PLATFORMS: Array<{ id: PlatformID; label: string }> = [
  { id: 'windows', label: 'Windows' },
  { id: 'macos', label: 'macOS' },
  { id: 'linux', label: 'Linux' },
]

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

export function IntegrationQuickStart() {
  const { t } = useTranslation()
  const [selectedTool, setSelectedTool] = useState<ToolID>('claude')
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformID>('macos')
  const [copiedTool, setCopiedTool] = useState<ToolID | null>(null)
  const origin =
    typeof window === 'undefined'
      ? 'https://your-new-api.example.com'
      : window.location.origin

  const tools = useMemo<Record<ToolID, ToolConfig>>(
    () => ({
      claude: {
        label: 'Claude Code',
        icon: TerminalSquare,
        description: t(
          'Route Anthropic-compatible requests through this gateway.'
        ),
        paths: {
          windows: '%USERPROFILE%\\.claude\\settings.json',
          macos: '~/.claude/settings.json',
          linux: '~/.claude/settings.json',
        },
        snippet: JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: origin,
              ANTHROPIC_AUTH_TOKEN: 'sk-your-token',
            },
          },
          null,
          2
        ),
      },
      codex: {
        label: 'Codex CLI',
        icon: Code2,
        description: t(
          'Use an OpenAI-compatible Responses endpoint as a custom provider.'
        ),
        paths: {
          windows: '%USERPROFILE%\\.codex\\config.toml',
          macos: '~/.codex/config.toml',
          linux: '~/.codex/config.toml',
        },
        snippet: [
          '# Export OPENAI_API_KEY=sk-your-token before starting Codex.',
          'model_provider = "newapi"',
          '',
          '[model_providers.newapi]',
          'name = "New API gateway"',
          `base_url = "${origin}/v1"`,
          'env_key = "OPENAI_API_KEY"',
          'wire_api = "responses"',
        ].join('\n'),
      },
      gemini: {
        label: 'Gemini CLI',
        icon: Sparkles,
        description: t(
          'Route Gemini API key authentication through this gateway.'
        ),
        paths: {
          windows: '%USERPROFILE%\\.gemini\\.env',
          macos: '~/.gemini/.env',
          linux: '~/.gemini/.env',
        },
        snippet: [
          'GEMINI_API_KEY=sk-your-token',
          `GOOGLE_GEMINI_BASE_URL=${origin}`,
        ].join('\n'),
      },
    }),
    [origin, t]
  )
  const activeTool = tools[selectedTool]
  const activePath = activeTool.paths[selectedPlatform]

  const copyConfig = async (tool: ToolID) => {
    try {
      const snippet = tools[tool].snippet
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(snippet)
        } catch {
          if (!copyTextFallback(snippet)) throw new Error('copy failed')
        }
      } else if (!copyTextFallback(snippet)) {
        throw new Error('copy failed')
      }
      setCopiedTool(tool)
      window.setTimeout(() => setCopiedTool(null), 1600)
    } catch {
      setCopiedTool(null)
    }
  }

  return (
    <section className='relative z-10 px-6 py-20 md:py-28'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,var(--muted),transparent_65%)] opacity-40'
      />
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mx-auto mb-10 max-w-3xl text-center'>
          <Badge variant='outline' className='mb-4'>
            {t('Quick start')}
          </Badge>
          <h2 className='text-2xl font-bold tracking-tight md:text-4xl'>
            {t('Connect your coding agent in minutes')}
          </h2>
          <p className='text-muted-foreground mx-auto mt-5 max-w-2xl leading-relaxed'>
            {t(
              'Pick a client, copy its local configuration, and replace the placeholder with a token from your account.'
            )}
          </p>
        </AnimateInView>

        <AnimateInView className='mb-6 grid gap-4 sm:grid-cols-3'>
          {(Object.keys(tools) as ToolID[]).map((tool) => {
            const config = tools[tool]
            const ToolIcon = config.icon
            const isActive = selectedTool === tool
            return (
              <button
                key={tool}
                type='button'
                aria-pressed={isActive}
                onClick={() => setSelectedTool(tool)}
                data-umami-event='home-tool-select'
                className='border-border/60 bg-card/80 hover:border-primary/40 hover:bg-card aria-pressed:border-primary aria-pressed:bg-card relative flex min-h-32 items-start gap-4 rounded-xl border p-5 text-left shadow-sm transition-all aria-pressed:shadow-md'
              >
                <span className='bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg'>
                  <ToolIcon className='size-5' />
                </span>
                <span className='min-w-0'>
                  <span className='block font-semibold'>{config.label}</span>
                  <span className='text-muted-foreground mt-2 block text-xs leading-5'>
                    {config.description}
                  </span>
                </span>
                {isActive && (
                  <CheckCircle2 className='text-primary absolute top-4 right-4 size-4' />
                )}
              </button>
            )
          })}
        </AnimateInView>

        <div className='grid items-stretch gap-6 lg:grid-cols-[0.88fr_1.12fr]'>
          <AnimateInView animation='fade-right' className='h-full'>
            <Card className='border-border/60 bg-card/80 h-full shadow-sm backdrop-blur-sm'>
              <CardHeader>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <CardTitle>{activeTool.label}</CardTitle>
                  <div
                    className='bg-muted flex rounded-lg p-1'
                    role='group'
                    aria-label={t('Config path')}
                  >
                    {PLATFORMS.map((platform) => (
                      <button
                        key={platform.id}
                        type='button'
                        aria-pressed={selectedPlatform === platform.id}
                        onClick={() => setSelectedPlatform(platform.id)}
                        className='text-muted-foreground hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-md px-3 py-1.5 text-xs font-medium transition-colors aria-pressed:shadow-sm'
                      >
                        {platform.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className='text-muted-foreground min-h-10 text-sm leading-5'>
                  {activeTool.description}
                </p>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='border-border/60 bg-background/70 grid min-h-24 grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border p-4'>
                  <span className='bg-primary/10 text-primary flex size-8 items-center justify-center rounded-md text-sm font-semibold'>
                    1
                  </span>
                  <div>
                    <p className='font-medium'>{t('Create API Key')}</p>
                    <p className='text-muted-foreground mt-1 text-xs leading-5'>
                      {t('Generate and manage your API access token')}
                    </p>
                  </div>
                </div>
                <div className='border-border/60 bg-background/70 grid min-h-24 grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border p-4'>
                  <span className='bg-primary/10 text-primary flex size-8 items-center justify-center rounded-md text-sm font-semibold'>
                    2
                  </span>
                  <div>
                    <p className='font-medium'>{activeTool.label}</p>
                    <p className='text-muted-foreground mt-1 text-xs leading-5'>
                      {t('Uses the gateway address from this deployment')}
                    </p>
                  </div>
                </div>
                <div className='border-border/60 bg-background/70 grid min-h-24 grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border p-4'>
                  <span className='bg-primary/10 text-primary flex size-8 items-center justify-center rounded-md text-sm font-semibold'>
                    3
                  </span>
                  <div className='min-w-0'>
                    <p className='font-medium'>{t('Configuration File')}</p>
                    <code className='text-muted-foreground mt-1 block overflow-x-auto text-xs leading-5 whitespace-nowrap'>
                      {activePath}
                    </code>
                  </div>
                </div>
                <div className='bg-muted/40 text-muted-foreground flex min-h-16 items-start gap-3 rounded-lg p-4 text-xs leading-5'>
                  <ShieldCheck className='mt-0.5 size-4 shrink-0 text-emerald-500' />
                  <span>
                    {t(
                      'The example token is a placeholder and is never submitted'
                    )}
                  </span>
                </div>
              </CardContent>
            </Card>
          </AnimateInView>

          <AnimateInView animation='fade-left' delay={80} className='h-full'>
            <Card className='border-border/60 bg-card/90 h-full overflow-hidden py-0 shadow-xl shadow-black/5 backdrop-blur-sm'>
              <CardContent className='flex min-h-[32rem] flex-1 flex-col p-0'>
                <div className='border-border/60 flex min-h-24 flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between'>
                  <div className='min-w-0'>
                    <p className='font-medium'>{activeTool.label}</p>
                    <p className='text-muted-foreground mt-1 truncate text-xs'>
                      {t('Config path')}: {activePath}
                    </p>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    className='w-full shrink-0 justify-center sm:w-28'
                    data-umami-event='home-config-copy'
                    onClick={() => void copyConfig(selectedTool)}
                  >
                    {copiedTool === selectedTool ? <Check /> : <Copy />}
                    {copiedTool === selectedTool
                      ? t('Copied')
                      : t('Copy config')}
                  </Button>
                </div>
                <pre className='h-80 flex-1 overflow-auto bg-slate-950 p-5 text-xs leading-6 text-slate-100'>
                  <code>{activeTool.snippet}</code>
                </pre>
                <div className='border-border/60 bg-muted/30 grid min-h-20 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-t px-5 py-3 text-xs'>
                  <TerminalSquare className='size-4 text-blue-500' />
                  <span className='text-muted-foreground'>
                    {t('Uses the gateway address from this deployment')}
                  </span>
                </div>
              </CardContent>
            </Card>
          </AnimateInView>
        </div>
      </div>
    </section>
  )
}
