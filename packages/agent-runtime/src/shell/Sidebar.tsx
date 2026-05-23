import type { CSSProperties, ReactNode } from 'react';
import type { ManifestTheme } from '../manifest/schema.js';

export interface NavItem { to: string; label: string; testId: string }

interface Props {
  theme: ManifestTheme;
  header: ReactNode;
  items: NavItem[];
  footer?: ReactNode;
  renderItem: (item: NavItem) => ReactNode;
}

export function Sidebar({ theme, header, items, footer, renderItem }: Props) {
  const tokens = theme.tokens ?? {};
  const style: CSSProperties = {
    background: tokens.sidebarBg ?? '#0a0a0a',
    color: tokens.sidebarFg ?? '#fafaf7',
    width: '256px',
  };
  return (
    <aside style={style} className="flex flex-shrink-0 flex-col">
      <div className="px-5 pb-6 pt-6">{header}</div>
      <div className="mx-5 mb-4 h-px bg-current opacity-15" aria-hidden />
      <nav className="flex-1 px-3" data-testid="sidebar-nav">
        {items.map((item) => (
          <div key={item.to} data-testid="nav-item" data-nav={item.to}>
            {renderItem(item)}
          </div>
        ))}
      </nav>
      {footer}
    </aside>
  );
}
