import { Loader2 } from 'lucide-react'

export function ProgressOverlay({ phase, progress }: { phase: string; progress: number }) {
  return (
    <div className="cz-progress-overlay">
      <div className="cz-progress-card">
        <Loader2 size={22} className="spin cz-progress-spinner" />
        <div className="cz-progress-text">
          <span className="cz-progress-phase">{phase}</span>
          <div className="cz-progress-bar">
            <div className="cz-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
