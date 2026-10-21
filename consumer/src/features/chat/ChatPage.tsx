import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  ArrowDown,
  Download,
  FileText,
  Info,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  RotateCcw,
  Trash2,
  X,
  BookOpen,
  Lightbulb,
  PencilLine,
  Plus,
  Square,
} from 'lucide-react'
import { Button, ConfirmDialog, Field, Input, LoadingState, Modal, Textarea } from '@/components/ui'
import { FrontendEntry } from '@/components/frontend-entry'
import { AnnouncementButton } from '@/features/announcements'
import { SiteMark } from '@/components/brand'
import { ChatModelPicker } from './ChatModelPicker'
import { authorizedFetch } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { useSession } from '@/lib/session'
import { usePreferredModel } from '@/lib/use-preferred-model'
import { consumeChatStream } from './stream'
import {
  loadConversations,
  saveConversations,
  loadChatWorkspace,
  saveChatWorkspace,
  type ChatMessage,
  type Conversation,
} from './history'
import { ConversationList } from './ConversationList'
import { MessageView } from './MessageView'
import { responseContext, downloadConversations } from './actions'
import { readStudyAttachment, type StudyAttachment } from './attachments'
import './chat.css'

export default function ChatPage() {
  const session = useSession()
  if (!session.user) return <LoadingState />
  return <ChatWorkspace key={session.user.id} userId={session.user.id} />
}

function ChatWorkspace(props: { userId: number }) {
  const { t } = useTranslation()
  const catalog = useCatalog()
  const session = useSession()
  const [conversations, setConversations] = useState(() => loadConversations(props.userId))
  const [workspace] = useState(() => loadChatWorkspace(props.userId))
  const [activeId, setActiveId] = useState<string | null>(() =>
    conversations.some((item) => item.id === workspace.activeId) ? workspace.activeId : null,
  )
  const [drafts, setDrafts] = useState(workspace.drafts)
  const draftKey = activeId || 'new'
  const draft = drafts[draftKey] || ''
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [draftKey]: value }))
  const [model, setModel] = usePreferredModel('chat')
  const [attachment, setAttachment] = useState<StudyAttachment | null>(null)
  const [readingFile, setReadingFile] = useState(false)
  const [fileError, setFileError] = useState('')
  const [responseAction, setResponseAction] = useState<'regenerate' | 'continue' | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const busy = activeId !== null && pendingIds.has(activeId)
  const [storageFailed, setStorageFailed] = useState(false)
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null)
  const [rename, setRename] = useState<Conversation | null>(null)
  const [remove, setRemove] = useState<Conversation | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [attachmentHelp, setAttachmentHelp] = useState(false)
  const [localHistoryHelp, setLocalHistoryHelp] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const [showLatest, setShowLatest] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const abortRefs = useRef(new Map<string, AbortController>())
  const mounted = useRef(true)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const latestConversations = useRef(conversations)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = conversations.find((conversation) => conversation.id === activeId)
  const messages = active?.messages || []
  const editMessage = useCallback((message: ChatMessage) => {
    setFileError('')
    setEditing({ id: message.id, content: message.content })
  }, [])
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  useLayoutEffect(() => {
    const input = textareaRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`
  }, [draft, activeId])

  function startConversation() {
    setActiveId(null)
    setEditing(null)
    setAttachment(null)
    setFileError('')
    setHistoryOpen(false)
    setShowLatest(false)
    nearBottom.current = true
    textareaRef.current?.focus()
  }

  useEffect(() => {
    if (!saveChatWorkspace(props.userId, { activeId, drafts })) setStorageFailed(true)
  }, [activeId, drafts, props.userId])

  useEffect(() => {
    latestConversations.current = conversations
  }, [conversations])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = null
      for (const controller of abortRefs.current.values()) controller.abort()
      saveConversations(
        props.userId,
        latestConversations.current.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.status === 'streaming' ? { ...message, status: 'stopped' as const } : message,
          ),
        })),
      )
    }
  }, [props.userId])
  useEffect(() => {
    if (!pendingIds.size) {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = null
      setStorageFailed(!saveConversations(props.userId, conversations))
      return
    }
    if (!saveTimer.current) {
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        setStorageFailed(!saveConversations(props.userId, latestConversations.current))
      }, 500)
    }
  }, [conversations, pendingIds.size, props.userId])
  useEffect(() => {
    if (nearBottom.current) messagesEnd.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function send(text: string, action?: 'regenerate' | 'continue', edited?: ChatMessage) {
    if (
      edited?.imageName &&
      !edited.image &&
      attachment?.name === edited.imageName &&
      attachment.image
    ) {
      edited = { ...edited, image: attachment.image }
    }
    const material = action || edited ? null : attachment
    const content = text.trim() + (material ? `\n\n[${material.name}]\n${material.text || ''}` : '')
    if (
      (!content && !action) ||
      !model ||
      !catalog.group ||
      (activeId && abortRefs.current.has(activeId)) ||
      abortRefs.current.size >= 30
    )
      return
    const controller = new AbortController()
    const chatId = activeId || crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    let previous = active?.messages || []
    if (action) {
      previous = responseContext(
        previous,
        action,
        t('Continue from where you stopped without repeating the previous response.'),
      )
    } else if (edited) {
      const messageIndex = previous.findIndex((message) => message.id === edited.id)
      if (messageIndex < 0) return
      previous = previous.slice(0, messageIndex)
    }
    const recoveryImage = edited ? attachment : material
    const missingImages = [...previous, ...(edited ? [edited] : [])].filter(
      (message) => message.imageName && !message.image,
    )
    if (
      missingImages.length === 1 &&
      recoveryImage?.image &&
      recoveryImage.name === missingImages[0]?.imageName
    ) {
      previous = previous.map((message) =>
        message.id === missingImages[0]?.id ? { ...message, image: recoveryImage.image } : message,
      )
    } else if (missingImages.length) {
      setFileError(
        'An image is missing from local history. Attach the original image with the same filename, or start a new conversation.',
      )
      return
    }
    setEditing(null)
    abortRefs.current.set(chatId, controller)
    setPendingIds(new Set(abortRefs.current.keys()))
    let retainedMessages = previous
    if (action === 'regenerate') {
      retainedMessages = (active?.messages || []).map((message, index, items) =>
        index === items.length - 1 ? { ...message, superseded: true } : message,
      )
    } else if (action === 'continue') {
      retainedMessages = [...(active?.messages || []), ...previous.slice(-1)]
    }
    const nextMessages: ChatMessage[] = [
      ...retainedMessages,
      ...(!action
        ? [
            {
              ...edited,
              id: edited?.id || crypto.randomUUID(),
              role: 'user' as const,
              content,
              status: 'complete' as const,
              image: edited?.image || material?.image,
              imageName: edited?.imageName || (material?.image ? material.name : undefined),
            },
          ]
        : []),
      { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
    ]
    setConversations((current) =>
      [
        {
          id: chatId,
          title: active?.title || content.slice(0, 60),
          updatedAt: Date.now(),
          messages: nextMessages,
        },
        ...current.filter((item) => item.id !== chatId),
      ].filter(
        (item, index, items) =>
          abortRefs.current.has(item.id) ||
          items.slice(0, index + 1).filter((entry) => !abortRefs.current.has(entry.id)).length <=
            30 - abortRefs.current.size,
      ),
    )
    setActiveId(chatId)
    if (!edited) {
      setDraft('')
      setAttachment(null)
    }
    textareaRef.current?.focus()
    nearBottom.current = true
    const update = (patch: Partial<ChatMessage>, delta = false) =>
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === chatId
            ? {
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        ...patch,
                        content: delta
                          ? message.content + (patch.content || '')
                          : (patch.content ?? message.content),
                        reasoning: delta
                          ? (message.reasoning || '') + (patch.reasoning || '')
                          : (patch.reasoning ?? message.reasoning),
                      }
                    : message,
                ),
              }
            : conversation,
        ),
      )
    try {
      const response = await authorizedFetch('/pg/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          model,
          group: catalog.group,
          stream: true,
          messages: [
            ...previous
              .filter(
                (message) =>
                  !message.superseded &&
                  message.content &&
                  (action === 'continue' || message.status !== 'error'),
              )
              .map((message) => ({
                role: message.role,
                content: message.image
                  ? [
                      { type: 'text', text: message.content },
                      { type: 'image_url', image_url: { url: message.image } },
                    ]
                  : message.content,
              })),
            ...(!action
              ? [
                  {
                    role: 'user',
                    content:
                      edited?.image || material?.image
                        ? [
                            { type: 'text', text: content },
                            {
                              type: 'image_url',
                              image_url: { url: edited?.image || material?.image },
                            },
                          ]
                        : content,
                  },
                ]
              : []),
          ],
        }),
      })
      await consumeChatStream(response, (delta) => update(delta, true), controller.signal)
      update({ status: 'complete' })
    } catch (error) {
      update({
        status: controller.signal.aborted ? 'stopped' : 'error',
        error: controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : 'The response could not be completed.',
      })
    } finally {
      if (abortRefs.current.get(chatId) === controller) {
        abortRefs.current.delete(chatId)
        if (mounted.current) {
          setPendingIds(new Set(abortRefs.current.keys()))
          void session.refreshUser().catch(() => undefined)
        }
      }
    }
  }

  async function attachFile(file: File) {
    if (busy || readingFile) return
    const targetId = activeId
    setReadingFile(true)
    setFileError('')
    try {
      const material = await readStudyAttachment(file)
      if (mounted.current && activeIdRef.current === targetId) setAttachment(material)
    } catch (error) {
      if (mounted.current && activeIdRef.current === targetId)
        setFileError(error instanceof Error ? error.message : 'The file could not be read.')
    } finally {
      setReadingFile(false)
    }
  }

  return (
    <div className={`chat-workspace ${historyCollapsed ? 'history-collapsed' : ''}`}>
      <aside className="chat-history" aria-label={t('Conversations')} hidden={historyCollapsed}>
        <div className="chat-history-heading">
          <span>{t('Your conversations')}</span>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label={t('Hide conversations')}
            title={t('Hide conversations')}
            onClick={() => setHistoryCollapsed(true)}
          >
            <PanelLeftClose size={18} />
          </Button>
        </div>
        <Button className="chat-new-button" variant="secondary" onClick={startConversation}>
          <Plus size={18} />
          {t('New conversation')}
        </Button>
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          disabled={false}
          onSelect={(conversation) => {
            setActiveId(conversation.id)
            setEditing(null)
            setAttachment(null)
            setFileError('')
            setShowLatest(false)
            nearBottom.current = true
          }}
          onRename={setRename}
          onRemove={setRemove}
        />
        <Button
          variant="ghost"
          className="chat-local-info"
          onClick={() => setLocalHistoryHelp(true)}
        >
          <Info size={15} />
          {t('Saved on this device')}
        </Button>
      </aside>
      <section className="chat-main" aria-label={t('AI chat')}>
        <div className="frontend-entry-toolbar">
          <AnnouncementButton />
          <FrontendEntry workspace />
        </div>
        <header className="chat-toolbar">
          <Button
            variant="ghost"
            className="icon-button chat-history-expand"
            aria-label={t('Show conversations')}
            title={t('Show conversations')}
            onClick={() => setHistoryCollapsed(false)}
          >
            <PanelLeftOpen size={19} />
          </Button>
          <Button
            variant="ghost"
            className="icon-button chat-mobile-history"
            aria-label={t('Conversations')}
            onClick={() => setHistoryOpen(true)}
          >
            <PanelLeftOpen size={19} />
          </Button>
          <ChatModelPicker model={model} onModelChange={setModel} disabled={busy} />
          <div className="chat-toolbar-actions">
            <Button
              variant="ghost"
              className="icon-button"
              aria-label={t('New conversation')}
              title={t('New conversation')}
              onClick={startConversation}
            >
              <PencilLine size={19} />
            </Button>
            <Button
              variant="ghost"
              className="icon-button"
              aria-label={t('Conversation options')}
              title={t('Conversation options')}
              onClick={() => setOptionsOpen(true)}
            >
              <MoreHorizontal size={21} />
            </Button>
          </div>
        </header>
        <div className={`chat-content ${!messages.length ? 'is-empty' : ''}`}>
          <div
            className="chat-scroll"
            ref={scrollRef}
            onScroll={() => {
              const element = scrollRef.current
              if (element) {
                nearBottom.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 120
                setShowLatest(!nearBottom.current)
              }
            }}
          >
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <SiteMark />
                <h1>{t('What is on your mind?')}</h1>
                <p className="muted">
                  {t('A fresh perspective, a first draft, or your next big idea. Start here.')}
                </p>
              </div>
            ) : (
              <div className="chat-messages" role="log" aria-label={t('Conversation messages')}>
                {messages.map((message) => (
                  <MessageView
                    key={message.id}
                    message={message}
                    editDisabled={busy}
                    onEdit={editMessage}
                  />
                ))}
                {messages.at(-1)?.role === 'assistant' && !busy && (
                  <div className="chat-response-actions">
                    <Button
                      variant="ghost"
                      disabled={readingFile}
                      onClick={() => setResponseAction('continue')}
                    >
                      <Plus size={14} />
                      {t('Continue response')}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={readingFile}
                      onClick={() => setResponseAction('regenerate')}
                    >
                      <RotateCcw size={14} />
                      {t('Regenerate response')}
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEnd} />
          </div>
          <div className="chat-composer-wrap">
            {showLatest && messages.length > 0 && (
              <Button
                variant="secondary"
                className="chat-jump-latest icon-button"
                aria-label={t('Jump to latest')}
                title={t('Jump to latest')}
                onClick={() => {
                  nearBottom.current = true
                  setShowLatest(false)
                  messagesEnd.current?.scrollIntoView({
                    block: 'end',
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'instant'
                      : 'smooth',
                  })
                }}
              >
                <ArrowDown size={18} />
              </Button>
            )}
            {storageFailed && (
              <p role="status" className="chat-storage-alert">
                {t('Browser storage is full or unavailable. This conversation will not be saved.')}
              </p>
            )}
            <form
              className={`chat-composer ${draggingFile ? 'is-dragging' : ''}`}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return
                event.preventDefault()
                dragDepth.current += 1
                setDraggingFile(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                dragDepth.current = Math.max(0, dragDepth.current - 1)
                if (!dragDepth.current) setDraggingFile(false)
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes('Files')) event.preventDefault()
              }}
              onDrop={(event) => {
                dragDepth.current = 0
                setDraggingFile(false)
                if (!event.dataTransfer.files.length) return
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file) void attachFile(file)
              }}
              onSubmit={(event) => {
                event.preventDefault()
                if (!readingFile) void send(draft)
              }}
            >
              {draggingFile && (
                <div className="chat-drop-hint">
                  <Paperclip size={22} />
                  {t('Drop a file here')}
                </div>
              )}
              {readingFile && (
                <p role="status" className="chat-attachment-status">
                  {t('Reading study material…')}
                </p>
              )}
              {attachment && (
                <div className="chat-attachment-preview">
                  {attachment.image ? (
                    <img src={attachment.image} alt={attachment.name} />
                  ) : (
                    <FileText size={24} />
                  )}
                  <span>{attachment.name}</span>
                  <Button
                    variant="ghost"
                    className="icon-button"
                    aria-label={t('Remove attachment')}
                    title={t('Remove attachment')}
                    disabled={busy}
                    onClick={() => setAttachment(null)}
                  >
                    <X size={15} />
                  </Button>
                </div>
              )}
              {fileError && (
                <p role="alert" className="chat-file-error">
                  {t(fileError)}
                </p>
              )}
              <Textarea
                ref={textareaRef}
                aria-label={t('Message')}
                placeholder={t('Ask anything, or start with an idea…')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const image = Array.from(event.clipboardData.items)
                    .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
                    ?.getAsFile()
                  if (!image) return
                  if (!event.clipboardData.getData('text/plain')) event.preventDefault()
                  void attachFile(image)
                }}
                maxLength={32_000}
                rows={1}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    if (!readingFile) void send(draft)
                  }
                }}
              />
              <div className="chat-composer-actions">
                <div className="chat-composer-tools">
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp,.pdf,.txt,.md,.csv"
                    disabled={busy || readingFile}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) void attachFile(file)
                    }}
                  />
                  <Button
                    variant="ghost"
                    className="icon-button"
                    aria-label={t('Images and files')}
                    title={t('Images and files')}
                    disabled={busy || readingFile}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus size={21} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="chat-attachment-help"
                    aria-label={t('Attachment help')}
                    title={t('Attachment help')}
                    onClick={() => setAttachmentHelp(true)}
                  >
                    <Paperclip size={14} />
                    <span>{t('Images and files')}</span>
                  </Button>
                </div>
                <span className="chat-shortcut muted">{t('Shift + Enter for a new line')}</span>
                {busy ? (
                  <Button
                    type="button"
                    className="chat-send icon-button"
                    onClick={() => {
                      if (activeId) abortRefs.current.get(activeId)?.abort()
                    }}
                    aria-label={t('Stop response')}
                    title={t('Stop response')}
                  >
                    <Square size={16} fill="currentColor" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="chat-send icon-button"
                    disabled={
                      (!draft.trim() && !attachment) || readingFile || !model || !catalog.group
                    }
                    aria-label={t('Send message')}
                    title={t('Send message')}
                  >
                    <ArrowUp size={20} />
                  </Button>
                )}
              </div>
            </form>
            {!messages.length && (
              <div className="chat-suggestions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(t('Help me turn a rough idea into a clear action plan.'))
                    textareaRef.current?.focus()
                  }}
                >
                  <Lightbulb size={16} />
                  {t('Make a plan')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(t('Help me write something clear and memorable. Ask me what I need.'))
                    textareaRef.current?.focus()
                  }}
                >
                  <PencilLine size={16} />
                  {t('Find the right words')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(
                      t(
                        'Explain a complex topic with a simple example. Ask me what I want to learn.',
                      ),
                    )
                    textareaRef.current?.focus()
                  }}
                >
                  <BookOpen size={16} />
                  {t('Learn something new')}
                </Button>
              </div>
            )}
            <p className="chat-footnote muted">
              {t(
                'AI can make mistakes. Check important information. Usage is billed to your selected service group.',
              )}
            </p>
          </div>
        </div>
      </section>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('Edit message')}
        description={t(
          'Saving sends a new billed request and removes all later messages. Cancel keeps the original conversation.',
        )}
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            const original = active?.messages.find((message) => message.id === editing?.id)
            if (editing && original) void send(editing.content, undefined, original)
          }}
        >
          <Textarea
            autoFocus
            aria-label={t('Edit message')}
            rows={8}
            value={editing?.content || ''}
            onChange={(event) =>
              setEditing((current) =>
                current ? { ...current, content: event.target.value } : null,
              )
            }
          />
          {fileError && <p role="alert">{t(fileError)}</p>}
          <div className="chat-response-actions">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={busy || readingFile || !editing?.content.trim() || !model || !catalog.group}
            >
              {t('Save and resend')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={attachmentHelp}
        onClose={() => setAttachmentHelp(false)}
        title={t('Images and files')}
      >
        <p className="muted">
          {t('Paste an image, drag a file, or use the plus button to attach it.')}
        </p>
        <p className="muted">
          {t(
            'Images need a vision-capable model. PDF text is extracted on this device; scanned PDFs need OCR. Files: 8 MB, PDF: 30 pages, text: 24,000 characters. Images are not saved in browser history.',
          )}
        </p>
      </Modal>
      <Modal
        open={localHistoryHelp}
        onClose={() => setLocalHistoryHelp(false)}
        title={t('Saved on this device')}
      >
        <p className="muted">
          {t(
            'Conversations are saved only on this device. Anyone using this browser profile may access them.',
          )}
        </p>
        <Button
          variant="secondary"
          disabled={!conversations.length}
          onClick={() => downloadConversations(conversations)}
        >
          <Download size={16} />
          {t('Back up local conversations')}
        </Button>
      </Modal>
      <Modal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title={t('Conversation options')}
      >
        <div className="chat-options-list">
          {active && (
            <>
              <p className="chat-options-title">{active.title}</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setOptionsOpen(false)
                  setRename(active)
                }}
              >
                <PencilLine size={17} />
                {t('Rename conversation')}
              </Button>
              <Button variant="ghost" onClick={() => downloadConversations([active])}>
                <Download size={17} />
                {t('Export conversation as Markdown')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOptionsOpen(false)
                  setRemove(active)
                }}
              >
                <Trash2 size={17} />
                {t('Delete conversation')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            disabled={!conversations.length}
            onClick={() => downloadConversations(conversations)}
          >
            <Download size={17} />
            {t('Back up local conversations')}
          </Button>
          <p className="muted">
            {t(
              'Conversations are saved only on this device. Anyone using this browser profile may access them.',
            )}
          </p>
        </div>
      </Modal>
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t('Your conversations')}
        description={t(
          'Conversations are saved only on this device. Anyone using this browser profile may access them.',
        )}
      >
        <Button
          variant="ghost"
          disabled={!conversations.length}
          onClick={() => downloadConversations(conversations)}
        >
          {t('Back up local conversations')}
        </Button>
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          disabled={false}
          onSelect={(conversation) => {
            setActiveId(conversation.id)
            setEditing(null)
            setAttachment(null)
            setFileError('')
            setShowLatest(false)
            nearBottom.current = true
            setHistoryOpen(false)
          }}
          onRename={(conversation) => {
            setHistoryOpen(false)
            setRename(conversation)
          }}
          onRemove={(conversation) => {
            setHistoryOpen(false)
            setRemove(conversation)
          }}
        />
      </Modal>
      <Modal
        open={rename !== null}
        onClose={() => setRename(null)}
        title={t('Rename conversation')}
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            if (rename?.title.trim()) {
              setConversations((current) =>
                current.map((conversation) =>
                  conversation.id === rename.id
                    ? { ...conversation, title: rename.title.trim() }
                    : conversation,
                ),
              )
              setRename(null)
            }
          }}
        >
          <Field label={t('Name')}>
            <Input
              autoFocus
              required
              maxLength={100}
              value={rename?.title || ''}
              onChange={(event) =>
                setRename((current) => (current ? { ...current, title: event.target.value } : null))
              }
            />
          </Field>
          <Button type="submit">{t('Save')}</Button>
        </form>
      </Modal>
      <ConfirmDialog
        open={responseAction !== null}
        onClose={() => setResponseAction(null)}
        title={t('Send another billed request?')}
        description={t(
          'Continuing or regenerating sends a new request using this conversation and the currently selected model and service group. It may incur another charge.',
        )}
        busy={busy}
        onConfirm={() => {
          const action = responseAction
          setResponseAction(null)
          if (action) void send('', action)
        }}
      />
      <ConfirmDialog
        open={remove !== null}
        onClose={() => setRemove(null)}
        title={t('Delete this conversation?')}
        description={t('This removes the conversation from this device. It cannot be undone.')}
        onConfirm={() => {
          if (remove) abortRefs.current.get(remove.id)?.abort()
          setConversations((current) =>
            current.filter((conversation) => conversation.id !== remove?.id),
          )
          if (activeId === remove?.id) setActiveId(null)
          setRemove(null)
        }}
      />
    </div>
  )
}
