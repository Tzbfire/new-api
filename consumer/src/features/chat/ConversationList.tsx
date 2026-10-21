import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle, PencilLine, Search, Trash2 } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import type { Conversation } from './history'

export function ConversationList(props: {
  conversations: Conversation[]
  activeId: string | null
  disabled: boolean
  onSelect: (conversation: Conversation) => void
  onRename: (conversation: Conversation) => void
  onRemove: (conversation: Conversation) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase()
  const visible = props.conversations.filter(
    (item) =>
      !query ||
      item.title.toLocaleLowerCase().includes(query) ||
      item.messages.some((message) => message.content.toLocaleLowerCase().includes(query)),
  )
  return (
    <div className="chat-history-list">
      <div className="chat-history-search">
        <Search size={14} aria-hidden />
        <Input
          aria-label={t('Search conversations')}
          placeholder={t('Search title or message')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {!visible.length && (
        <p role="status" className="muted chat-history-empty">
          {props.conversations.length
            ? t('No matching conversations')
            : t('Your next idea starts a conversation.')}
        </p>
      )}
      {visible.map((conversation) => (
        <div
          key={conversation.id}
          className={`chat-history-item ${props.activeId === conversation.id ? 'is-active' : ''}`}
        >
          <Button
            variant="ghost"
            disabled={props.disabled}
            className="chat-history-select"
            title={conversation.title}
            aria-current={props.activeId === conversation.id ? 'true' : undefined}
            onClick={() => props.onSelect(conversation)}
          >
            <MessageCircle size={15} />
            <span>{conversation.title}</span>
            {conversation.messages.some((message) => message.status === 'streaming') && (
              <span role="status"> {t('Responding…')}</span>
            )}
          </Button>
          <Button
            variant="ghost"
            disabled={props.disabled}
            aria-label={t('Rename conversation')}
            onClick={() => props.onRename(conversation)}
          >
            <PencilLine size={13} />
          </Button>
          <Button
            variant="ghost"
            disabled={props.disabled}
            aria-label={t('Delete conversation')}
            onClick={() => props.onRemove(conversation)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
    </div>
  )
}
