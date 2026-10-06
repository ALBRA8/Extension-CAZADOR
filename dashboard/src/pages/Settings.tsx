import { useState } from 'react'

export function SettingsPage() {
  const [tab, setTab] = useState<'account' | 'billing' | 'integrations' | 'notifications' | 'advanced'>('account')

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Ajustes</h1>
          <p className="page-sub">Configura tu cuenta, facturación, integraciones y preferencias.</p>
        </div>
      </div>

      <div className="card">
        <div className="tabs">
          <div className={`tab ${tab === 'account' ? 'active' : ''}`} onClick={() => setTab('account')}>Cuenta</div>
          <div className={`tab ${tab === 'billing' ? 'active' : ''}`} onClick={() => setTab('billing')}>Facturación</div>
          <div className={`tab ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>Integraciones</div>
          <div className={`tab ${tab === 'notifications' ? 'active' : ''}`} onClick={() => setTab('notifications')}>Notificaciones</div>
          <div className={`tab ${tab === 'advanced' ? 'active' : ''}`} onClick={() => setTab('advanced')}>Avanzado</div>
        </div>

        {tab === 'account' && <AccountTab />}
        {tab === 'billing' && <BillingTab />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'advanced' && <AdvancedTab />}
      </div>
    </>
  )
}

function AccountTab() {
  return (
    <div style={{ maxWidth: 520 }}>
      <div className="field">
        <label>Nombre completo</label>
        <input type="text" defaultValue="María Z." />
      </div>
      <div className="field">
        <label>Email</label>
        <input type="email" defaultValue="maria@empresa.com" />
      </div>
      <div className="field">
        <label>Empresa</label>
        <input type="text" defaultValue="Acme Inc." />
      </div>
      <div className="field">
        <label>Idioma preferido</label>
        <select>
          <option>Español (Latinoamérica)</option>
          <option>Español (España)</option>
          <option>English (US)</option>
          <option>Português (Brasil)</option>
        </select>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary">Guardar cambios</button>
        <button className="btn btn-ghost">Cancelar</button>
      </div>
    </div>
  )
}

function BillingTab() {
  return (
    <div>
      <div className="card" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 20 }}>
        <div className="between mb-16">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Plan Pro</div>
            <div className="soft" style={{ fontSize: 13 }}>3.000 créditos al mes · $16,50/mes · facturación anual</div>
          </div>
          <span className="pill pill-success">Activo</span>
        </div>
        <div className="mb-16">
          <div className="between mb-12">
            <span style={{ fontSize: 13 }}>1.847 / 3.000 créditos usados</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>61%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: '61%' }} />
          </div>
          <div className="soft mt-16" style={{ fontSize: 12 }}>Se renueva el 15 de julio de 2026.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm">Cambiar de plan</button>
          <button className="btn btn-ghost btn-sm">Ver facturas</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>Cancelar suscripción</button>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Método de pago</div>
        <div className="row between">
          <div className="row" style={{ gap: 12 }}>
            <div style={{ width: 40, height: 28, background: 'var(--surface-2)', borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700 }}>VISA</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>•••• •••• •••• 4242</div>
              <div className="soft" style={{ fontSize: 11 }}>Caduca 09/27</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm">Actualizar</button>
        </div>
      </div>
    </div>
  )
}

function IntegrationsTab() {
  const integrations = [
    { name: 'Google Sheets', status: 'connected', icon: '📊', desc: 'Sincroniza tus scrapes directamente a una hoja de Google.' },
    { name: 'Notion', status: 'connected', icon: '📝', desc: 'Crea filas en una base de datos de Notion.' },
    { name: 'Airtable', status: 'available', icon: '🗂️', desc: 'Push a bases de Airtable.' },
    { name: 'Slack', status: 'available', icon: '💬', desc: 'Recibe notificaciones de scrapes programados.' },
    { name: 'Zapier', status: 'available', icon: '⚡', desc: 'Conecta con 5.000+ apps vía Zapier.' },
    { name: 'Webhook', status: 'available', icon: '🔗', desc: 'POST HTTP a tu URL custom.' },
  ]
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16,
    }}>
      {integrations.map((i) => (
        <div key={i.name} className="card" style={{ padding: 16 }}>
          <div className="between mb-12">
            <span style={{ fontSize: 28 }}>{i.icon}</span>
            {i.status === 'connected'
              ? <span className="pill pill-success">✓ Conectado</span>
              : <span className="pill pill-neutral">Disponible</span>}
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{i.name}</div>
          <div className="soft" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>{i.desc}</div>
          <button className={`btn btn-sm ${i.status === 'connected' ? 'btn-ghost' : 'btn-primary'}`}>
            {i.status === 'connected' ? 'Configurar' : 'Conectar'}
          </button>
        </div>
      ))}
    </div>
  )
}

function NotificationsTab() {
  const items = [
    { label: 'Scrape completado', desc: 'Recibir email cuando un scrape termine.', on: true },
    { label: 'Scrape fallido', desc: 'Notificar inmediatamente si un scrape falla.', on: true },
    { label: 'Casi sin créditos', desc: 'Avisar cuando queden <10% de créditos del mes.', on: true },
    { label: 'Resumen semanal', desc: 'Email cada lunes con tu actividad.', on: false },
    { label: 'Cambio de precio detectado', desc: 'Cuando un scrape programado detecta un cambio.', on: true },
    { label: 'Nuevas features', desc: 'Anuncios de producto (máx 1 al mes).', on: false },
  ]
  return (
    <div style={{ maxWidth: 600 }}>
      {items.map((i) => (
        <div key={i.label} className="between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{i.label}</div>
            <div className="soft" style={{ fontSize: 12 }}>{i.desc}</div>
          </div>
          <Toggle defaultOn={i.on} />
        </div>
      ))}
    </div>
  )
}

function AdvancedTab() {
  return (
    <div style={{ maxWidth: 600 }}>
      <div className="card" style={{ background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)', marginBottom: 16 }}>
        <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>Zona de peligro</div>
        <div className="soft" style={{ fontSize: 13, marginBottom: 12 }}>
          Estas acciones son irreversibles. Procede con cuidado.
        </div>
        <div className="between" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Borrar todo el historial de scrapes</div>
            <div className="soft" style={{ fontSize: 12 }}>No afecta a tu suscripción ni créditos.</div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
            Borrar historial
          </button>
        </div>
        <div className="between">
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Cerrar y eliminar cuenta</div>
            <div className="soft" style={{ fontSize: 12 }}>Todos tus datos se eliminarán permanentemente.</div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
            Eliminar cuenta
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Preferencias técnicas</div>
        <div className="field">
          <label>Backend URL</label>
          <input type="text" defaultValue="http://localhost:8787" />
          <span className="field-hint">URL del servidor local que corre el modelo IA (z-ai-web-dev-sdk).</span>
        </div>
        <div className="field">
          <label>Timeout de scrape (segundos)</label>
          <input type="number" defaultValue={60} />
        </div>
        <button className="btn btn-primary btn-sm">Guardar</button>
      </div>
    </div>
  )
}

function Toggle({ defaultOn }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn)
  return (
    <button
      onClick={() => setOn(!on)}
      style={{
        width: 36, height: 20, borderRadius: 999,
        background: on ? 'var(--gradient-brand)' : 'var(--surface-2)',
        position: 'relative', transition: 'background 0.15s',
        border: '1px solid var(--border)',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 14, height: 14, borderRadius: '50%', background: 'white',
        transition: 'left 0.15s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }} />
    </button>
  )
}
