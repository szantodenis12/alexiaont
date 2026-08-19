import type { ReactNode } from 'react';

interface AdminLayoutProps {
  /** Center-of-header content, typically the primary nav links (AdminDashboard) */
  center?: ReactNode;
  /** Right-of-header content, e.g. a logout button or a "back to dashboard" link */
  actions?: ReactNode;
  /** Preserves each page's existing content width so no layout shifts */
  mainMaxWidth: number;
  children: ReactNode;
}

export function AdminLayout({ center, actions, mainMaxWidth, children }: AdminLayoutProps) {
  return (
    <div className="admin-wrapper" data-theme="dark">
      <header className="admin-header">
        <div className="header-logo">
          <img src="/LOGO ALBUME.svg" alt="Alexia Graduation Albums Logo" style={{ height: '36px', width: 'auto' }} />
          <span className="admin-badge">Admin</span>
        </div>
        {center && <nav className="header-nav">{center}</nav>}
        {actions}
      </header>
      <main className="admin-main" style={{ maxWidth: `${mainMaxWidth}px` }}>
        {children}
      </main>
    </div>
  );
}
