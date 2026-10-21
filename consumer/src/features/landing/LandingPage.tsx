import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ImagePlus,
  MessageCircle,
  KeyRound,
  Layers3,
  ChartNoAxesCombined,
  Wallet,
  Route,
  Braces,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PublicHeader, PublicFooter } from '@/components/public-layout'
import { SiteMark } from '@/components/brand'
import { useSiteBrand } from '@/lib/use-site-brand'
import { useSession } from '@/lib/session'

export default function LandingPage() {
  const { t } = useTranslation()
  const session = useSession()
  const siteBrand = useSiteBrand()
  const signedIn = session.status === 'authenticated' && session.user !== null
  return (
    <div className="landing">
      <PublicHeader />
      <main id="main-content">
        <section className="hero">
          <div className="hero-copy">
            <span className="hero-kicker">
              <span className="status-dot" />
              {t('AI model platform')}
            </span>
            <h1>
              {t('Leading models.')}
              <br />
              <em>{t('One simple API.')}</em>
              <span className="hero-spark">✦</span>
            </h1>
            <p>
              {t(
                'Access AI models in one place. Compare service groups and real prices, connect with an API key, and track every request. Chat and create images right here, too.',
              )}
            </p>
            <div className="hero-actions">
              <Link to="/chat" className="button button-primary button-large">
                {signedIn ? t('Continue chatting') : t('Ask your first question')}
                <ArrowRight size={18} />
              </Link>
              <Link to="/studio" className="text-link">
                {signedIn ? t('Open image studio') : t('Create your first image')}
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="hero-promises">
              <span>
                <Check size={14} />
                {t('One endpoint. Multiple models.')}
              </span>
              <span>
                <Check size={14} />
                {t('Transparent, usage-based pricing')}
              </span>
            </div>
          </div>
          <div className="gateway-preview" aria-label={t('Unified model access')}>
            <div className="gateway-preview-header">
              <span className="row">
                <span className="status-dot" />
                {t('Your AI connection')}
              </span>
              <span>{siteBrand.domain || siteBrand.name}</span>
            </div>
            <div className="provider-grid">
              <span className="provider-pill">
                <i className="provider-monogram green">O</i>OpenAI
              </span>
              <span className="provider-pill">
                <i className="provider-monogram coral">✳</i>Claude
              </span>
              <span className="provider-pill">
                <i className="provider-monogram purple">✧</i>Gemini
              </span>
              <span className="provider-pill">
                <i className="provider-monogram blue">D</i>DeepSeek
              </span>
            </div>
            <div className="gateway-branches" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="gateway-hub">
              <SiteMark />
              <div>
                <strong>{siteBrand.name}</strong>
                <span>{t('Unified access · Service groups · Billing')}</span>
              </div>
              <Route size={23} />
            </div>
            <div className="gateway-stem" aria-hidden="true" />
            <div className="gateway-endpoint">
              <Braces size={18} />
              <code>/v1/chat/completions</code>
              <Check size={15} />
            </div>
            <div className="gateway-meta">
              <span>
                <KeyRound size={14} />
                {t('Your API key')}
              </span>
              <span>
                <Layers3 size={14} />
                {t('Your service group')}
              </span>
            </div>
            <div className="gateway-note">
              <span>↗</span>
              {t('Switch models. Keep your workflow.')}
            </div>
          </div>
        </section>
        <section className="model-strip" aria-label={t('Unified model access')}>
          <span>{t('MANY MODELS. ONE GATEWAY.')}</span>
          <strong>OpenAI</strong>
          <strong>Claude</strong>
          <strong>Gemini</strong>
          <strong>DeepSeek</strong>
          <span className="muted">{t('Availability follows your service group')}</span>
        </section>
        <section className="landing-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('From choosing a model to your first request')}</span>
              <h2>{t('Everything you need. Clearly connected.')}</h2>
            </div>
            <p>
              {t('Models, pricing, API keys and spending. The essentials, without the clutter.')}
            </p>
          </div>
          <div className="feature-showcase">
            <Link to="/explore" className="showcase-card chat-showcase">
              <div className="showcase-top">
                <Layers3 size={22} />
                <ArrowUpRight size={19} />
              </div>
              <h3>{t('Choose with confidence.')}</h3>
              <p>
                {t(
                  'See which models each service group offers, its multiplier, and the price for your usage.',
                )}
              </p>
              <div className="plan-preview">
                <span>
                  <span className="status-dot" />
                  {t('Service group')}
                </span>
                <div>
                  <strong>{t('Available models')}</strong>
                  <Check size={14} />
                </div>
                <div>
                  <strong>{t('Actual pricing')}</strong>
                  <Check size={14} />
                </div>
                <div>
                  <strong>{t('Clear multipliers')}</strong>
                  <Check size={14} />
                </div>
              </div>
            </Link>
            <Link to="/keys" className="showcase-card studio-showcase">
              <div className="showcase-top">
                <KeyRound size={22} />
                <ArrowUpRight size={19} />
              </div>
              <h3>{t('Connect in a few steps.')}</h3>
              <p>
                {t(
                  'Create an API key, choose its group, and connect your favorite tools with a unified endpoint.',
                )}
              </p>
              <div className="api-preview">
                <div>
                  <span className="code-muted">Authorization</span>
                  <span>Bearer sk-••••••••</span>
                </div>
                <div>
                  <span className="code-muted">model</span>
                  <span>{t('Your choice')}</span>
                </div>
                <span className="api-preview-label">
                  <Braces size={14} />
                  {t('Works with compatible AI tools')}
                </span>
              </div>
            </Link>
            <Link to="/usage" className="showcase-card connect-showcase">
              <div className="showcase-top">
                <ChartNoAxesCombined size={22} />
                <ArrowUpRight size={19} />
              </div>
              <h3>{t('Know where every cent goes.')}</h3>
              <p>
                {t(
                  'Review call history and final charges. Manage your balance, recharge, and find a suitable plan.',
                )}
              </p>
              <div className="usage-preview">
                <div>
                  <ReceiptIcon />
                  <span>{t('Call records')}</span>
                  <Check size={14} />
                </div>
                <div>
                  <Wallet size={16} />
                  <span>{t('Balance and recharge')}</span>
                  <Check size={14} />
                </div>
                <div>
                  <ChartNoAxesCombined size={16} />
                  <span>{t('Usage and costs')}</span>
                  <Check size={14} />
                </div>
              </div>
            </Link>
          </div>
        </section>
        <section className="try-ai-section">
          <div>
            <span className="eyebrow">{t('TRY IT BEFORE YOU CONNECT')}</span>
            <h2>{t('Your models, ready to use.')}</h2>
            <p>
              {t(
                'Start a conversation or create images directly. The same service groups and transparent billing apply.',
              )}
            </p>
          </div>
          <Link to="/chat">
            <MessageCircle size={23} />
            <span>
              <strong>{t('AI chat')}</strong>
              <small>{t('Compare ideas. Find answers.')}</small>
            </span>
            <ArrowUpRight size={18} />
          </Link>
          <Link to="/studio">
            <ImagePlus size={23} />
            <span>
              <strong>{t('Image studio')}</strong>
              <small>{t('Generate, batch, and manage images.')}</small>
            </span>
            <ArrowUpRight size={18} />
          </Link>
        </section>
        <section className="pricing-banner">
          <span className="pricing-flower">✳</span>
          <div>
            <span className="eyebrow">{t('Clear choices. No guesswork.')}</span>
            <h2>{t('A service group that fits your needs.')}</h2>
            <p>
              {t(
                'Compare available models and real pricing across service plans. Your choice, always visible.',
              )}
            </p>
          </div>
          <Link to="/explore" className="button button-secondary">
            {t('Compare service groups')}
            <ArrowUpRight size={17} />
          </Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
function ReceiptIcon() {
  return <Route size={16} />
}
