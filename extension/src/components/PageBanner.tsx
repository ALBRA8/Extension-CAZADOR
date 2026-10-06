import { Globe, Tag } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'

export function PageBanner() {
  const { url, title, pageCategory, detectedItems, estimatedRows } = useSidebarStore()

  if (url === 'loading') {
    return <div className="cz-page-banner cz-loading-banner">Cargando información de la página…</div>
  }

  return (
    <div className="cz-page-banner">
      <div className="cz-page-banner-row">
        <Globe size={14} className="cz-page-icon" />
        <span className="cz-page-title" title={title}>{title || url}</span>
      </div>
      <div className="cz-page-banner-meta">
        {pageCategory && (
          <span className="cz-chip cz-chip-brand">
            <Tag size={11} /> {pageCategory}
          </span>
        )}
        {detectedItems > 0 && (
          <span className="cz-chip">{detectedItems} items detectados</span>
        )}
        {estimatedRows > 0 && (
          <span className="cz-chip cz-chip-success">~{estimatedRows} filas extraíbles</span>
        )}
      </div>
    </div>
  )
}
