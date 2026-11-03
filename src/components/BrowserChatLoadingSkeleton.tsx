export function BrowserChatLoadingSkeleton({ label, workspace = false }: { label: string; workspace?: boolean }) {
  return (
    <div
      aria-label={label}
      aria-live="polite"
      className={`browser-chat-loading-skeleton${workspace ? ' browser-chat-loading-skeleton--workspace' : ''}`}
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="browser-chat-skeleton-header">
        <span className="browser-chat-skeleton-bar" />
        <div>{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</div>
      </div>
      <div aria-hidden="true" className="browser-chat-skeleton-messages">
        <div className="browser-chat-skeleton-user">
          <span className="browser-chat-skeleton-bar" />
          <span className="browser-chat-skeleton-bar" />
        </div>
        {[0, 1].map((index) => (
          <div className="browser-chat-skeleton-reply" key={index}>
            <span className="browser-chat-skeleton-bar browser-chat-skeleton-title" />
            {[0, 1, 2, 3].map((line) => <span className="browser-chat-skeleton-bar" key={line} />)}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="browser-chat-skeleton-composer">
        <span className="browser-chat-skeleton-bar" />
        <div><span /><span /></div>
      </div>
    </div>
  );
}
