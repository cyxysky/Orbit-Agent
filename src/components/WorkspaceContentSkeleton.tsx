export function WorkspaceContentSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-live="polite" className="workspace-content-skeleton" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="workspace-content-skeleton-card">
        <span className="workspace-content-skeleton-title" />
        {[0, 1, 2, 3].map((row) => (
          <div className="workspace-content-skeleton-row" key={row}><span /><i /></div>
        ))}
      </div>
      <div aria-hidden="true" className="workspace-content-skeleton-grid">
        {[0, 1].map((card) => (
          <div className="workspace-content-skeleton-card" key={card}>
            <span className="workspace-content-skeleton-title" />
            <span className="workspace-content-skeleton-line" />
            <span className="workspace-content-skeleton-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
