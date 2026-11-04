export function WorkspacePageSkeleton({ label, variant = 'list', showHeader = true }: {
  label: string;
  variant?: 'overview' | 'list' | 'settings';
  showHeader?: boolean;
}) {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => <div className="workspace-skeleton-row" key={index}><i /><i /><i /></div>);
  return <div className={`workspace-page-skeleton is-${variant}`} aria-label={label} role="status">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">
      {showHeader ? <div className="workspace-skeleton-heading"><i /><i /></div> : null}
      {variant === 'overview' ? <>
        <div className="workspace-skeleton-metrics">{Array.from({ length: 4 }, (_, index) => <div key={index}><i /><i /><i /></div>)}</div>
        <div className="workspace-skeleton-chart-grid"><div className="workspace-skeleton-chart"><i /></div><div className="workspace-skeleton-panel">{lines(4)}</div></div>
        <div className="workspace-skeleton-panel">{lines(5)}</div>
      </> : variant === 'settings' ? <div className="workspace-skeleton-settings"><div>{lines(4)}</div><div className="workspace-skeleton-panel">{lines(6)}</div></div>
        : <div className="workspace-skeleton-panel">{lines(7)}</div>}
    </div>
  </div>;
}
