import { useState } from 'react'
import {
  Zap, LayoutDashboard, Briefcase, Calendar, LayoutTemplate,
  KeyRound, Settings, HelpCircle, LogOut, Search, Bell,
} from 'lucide-react'
import { OverviewPage } from '@/pages/Overview'
import { JobsPage } from '@/pages/Jobs'
import { ScheduledPage } from '@/pages/Scheduled'
import { TemplatesPage } from '@/pages/Templates'
import { ApiKeysPage } from '@/pages/ApiKeys'
import { SettingsPage } from '@/pages/Settings'

type Page = 'overview' | 'jobs' | 'scheduled' | 'templates' | 'api-keys' | 'settings'

export function Dashboard() {
  const [page, setPage] = useState<Page>('overview')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo"><Zap size={16} fill="white" strokeWidth={2.5} /></span>
          Thunderbit
        </div>

        <div className="nav-section">General</div>
        <NavItem icon={<LayoutDashboard size={16} />} label="Dashboard" active={page === 'overview'} onClick={() => setPage('overview')} />
        <NavItem icon={<Briefcase size={16} />} label="Mis scrapes" active={page === 'jobs'} onClick={() => setPage('jobs')} />
        <NavItem icon={<Calendar size={16} />} label="Programados" active={page === 'scheduled'} onClick={() => setPage('scheduled')} />

        <div className="nav-section">Recursos</div>
        <NavItem icon={<LayoutTemplate size={16} />} label="Plantillas" active={page === 'templates'} onClick={() => setPage('templates')} />
        <NavItem icon={<KeyRound size={16} />} label="API Keys" active={page === 'api-keys'} onClick={() => setPage('api-keys')} />
        <NavItem icon={<Settings size={16} />} label="Ajustes" active={page === 'settings'} onClick={() => setPage('settings')} />

        <div className="sidebar-footer">
          <div className="user-card">
            <span className="user-avatar">MZ</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-name">María Z.</div>
              <div className="user-email">maria@empresa.com</div>
            </div>
            <button className="btn-icon" title="Cerrar sesión"><LogOut size={14} /></button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="between mb-24">
          <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-soft)' }} />
            <input
              type="text"
              placeholder="Buscar scrapes, URLs, plantillas…"
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 9,
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>
          <div className="row">
            <span className="pill pill-info">Plan Pro · 1.847 / 3.000 créditos</span>
            <button className="btn-icon"><Bell size={16} /></button>
            <button className="btn-icon"><HelpCircle size={16} /></button>
          </div>
        </div>

        {page === 'overview' && <OverviewPage />}
        {page === 'jobs' && <JobsPage />}
        {page === 'scheduled' && <ScheduledPage />}
        {page === 'templates' && <TemplatesPage />}
        {page === 'api-keys' && <ApiKeysPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

function NavItem({
  icon, label, active, onClick,
}: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <div className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </div>
  )
}
