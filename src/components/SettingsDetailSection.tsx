import type { ReactNode } from 'react';

export function SettingsDetailSection({ children, className = '', description, heading, meta }: {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  heading?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <section className={`settings-detail-panel${className ? ` ${className}` : ''}`}>
      {heading ? (
        <header className="settings-detail-panel-head">
          <div><h3>{heading}</h3>{description ? <span>{description}</span> : null}</div>
          {meta ? <small className="settings-detail-panel-meta">{meta}</small> : null}
        </header>
      ) : null}
      <div className="settings-detail-panel-body">{children}</div>
    </section>
  );
}
