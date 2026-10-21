import { memo, isValidElement, type ReactNode } from 'react'
import { PencilLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, CopyButton } from '@/components/ui'
import type { ChatMessage } from './history'

/** Completed messages keep their Markdown tree while another message streams. */
export const MessageView = memo(function MessageView(props: {
  message: ChatMessage
  onEdit?: (message: ChatMessage) => void
  editDisabled?: boolean
}) {
  const { t } = useTranslation()
  const message = props.message
  return (
    <article className={`chat-message chat-message-${message.role}`}>
      <span className="eyebrow">{message.role === 'user' ? t('You') : t('Assistant')}</span>
      {message.reasoning && (
        <details className="chat-reasoning">
          <summary>
            {message.status === 'streaming' && !message.content
              ? t('Thinking')
              : t('Thinking process')}
          </summary>
          <div>{message.reasoning}</div>
        </details>
      )}
      {message.superseded && (
        <p className="muted">
          {t('Previous response kept for reference; excluded from future requests')}
        </p>
      )}
      {message.image?.startsWith('data:image/') && (
        <img
          className="chat-message-attachment"
          src={message.image}
          alt={message.imageName || t('Attach study material')}
        />
      )}
      {message.imageName && (
        <p className="muted">
          {message.imageName} · {t('Image attachment is available only in this session')}
        </p>
      )}
      <div className="chat-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: (codeProps) => {
              const child = codeProps.children
              const code = isValidElement<{ children?: ReactNode }>(child)
                ? String(child.props.children ?? '')
                : ''
              return (
                <div className="chat-code-block">
                  <CopyButton value={code.replace(/\n$/, '')} label={t('Copy code')} />
                  <pre>{child}</pre>
                </div>
              )
            },
            a: (linkProps) => (
              <a href={linkProps.href} target="_blank" rel="noopener noreferrer">
                {linkProps.children}
              </a>
            ),
            img: (imageProps) => (
              <a
                href={
                  typeof imageProps.src === 'string' && imageProps.src.startsWith('https://')
                    ? imageProps.src
                    : undefined
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                {imageProps.alt || t('Open image link')}
              </a>
            ),
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
      {message.status === 'streaming' && (
        <span className="chat-typing" role="status" aria-label={t('Writing a response')}>
          ● ● ●
        </span>
      )}
      {message.status === 'stopped' && (
        <p className="muted">{t('Response stopped. Partial responses may still be billed.')}</p>
      )}
      {message.status === 'error' && (
        <p role="alert" className="chat-message-error">
          {t(message.error || 'The response could not be completed.')}{' '}
          {t('Your message is kept. Try again when you are ready.')}
        </p>
      )}
      {message.role === 'user' && props.onEdit && (
        <div className="chat-message-actions">
          <Button
            variant="ghost"
            disabled={props.editDisabled}
            onClick={() => props.onEdit?.(message)}
            title={
              props.editDisabled
                ? t('Stop the response before editing messages.')
                : t('Edit message')
            }
          >
            <PencilLine size={14} aria-hidden="true" />
            {t('Edit message')}
          </Button>
        </div>
      )}
      {message.role === 'assistant' && message.content && message.status !== 'streaming' && (
        <CopyButton value={message.content} label={t('Copy response')} />
      )}
    </article>
  )
})
