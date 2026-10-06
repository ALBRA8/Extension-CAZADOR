import { Target, History, RefreshCw } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'

export function Header({ onOpenHistory }: { onOpenHistory: () => void }) {
  const { reset } = useSidebarStore()

  return (
    <header className="cz-header">
      <div className="cz-logo">
        <div className="cz-logo-mark">
          <Target size={18} fill="white" strokeWidth={2.5} />
        </div>
        <div className="cz-logo-text">
          <span className="cz-logo-name">Cazador</span>
          <span className="cz-logo-tag">AI Web Scraper</span>
        </div>
      </div>

      <div className="cz-header-actions">
        <button
          className="cz-icon-btn"
          onClick={onOpenHistory}
          title="Historial de scrapes"
        >
          <History size={16} />
        </button>
        <button
          className="cz-icon-btn"
          onClick={reset}
          title="Empezar de nuevo"
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </header>
  )
}
