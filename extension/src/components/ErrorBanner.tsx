import { AlertTriangle, X } from 'lucide-react'

export function ErrorBanner({ error, onClose }: { error: string | null; onClose: () => void }) {
  if (!error) return null
  return (
    <div className="cz-error-banner">
      <AlertTriangle size={14} />
      <span>{error}</span>
      <button onClick={onClose} title="Cerrar">
        <X size={14} />
      </button>
    </div>
  )
}
