import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

export default function AnnouncementContent(props: { content: string }) {
  return (
    <div className="announcement-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: (link) => (
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              {link.children}
            </a>
          ),
          img: (image) => (
            <img
              src={image.src}
              alt={image.alt || ''}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ),
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  )
}
