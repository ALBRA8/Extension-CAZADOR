import { Zap, Github, Twitter } from 'lucide-react'
import '@/styles/components.css'

export function Navbar() {
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a href="#" className="nav-brand">
          <span className="nav-logo"><Zap size={18} fill="white" strokeWidth={2.5} /></span>
          Thunderbit Clone
        </a>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#comparativa">Comparativa</a>
          <a href="#pricing">Precios</a>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href="#pricing" className="btn btn-ghost">Iniciar sesión</a>
          <a href="#install" className="btn btn-primary">
            <Zap size={15} fill="white" /> Añadir a Chrome
          </a>
        </div>
      </div>
    </nav>
  )
}

export function Hero() {
  return (
    <header className="hero">
      <div className="container">
        <span className="hero-eyebrow">
          <Zap size={13} fill="currentColor" /> Créditos transparentes · Sin sorpresas
        </span>
        <h1>
          Scrapea cualquier web con IA <br />
          <span className="gradient-text">en solo 2 clics</span>
        </h1>
        <p className="hero-sub">
          La IA lee la página, sugiere las columnas y extrae los datos a una hoja
          de cálculo limpia. Sin selectores CSS. Sin código. Y a diferencia del
          original: <strong>ves el costo antes de scrapear</strong>.
        </p>
        <div className="hero-actions">
          <a href="#install" className="btn btn-primary btn-lg">
            <Zap size={16} fill="white" /> Añadir a Chrome — Gratis
          </a>
          <a href="#como-funciona" className="btn btn-ghost btn-lg">
            Ver demo
          </a>
        </div>
        <div className="hero-meta">
          <span className="hero-meta-item">✓ 6 páginas gratis al mes</span>
          <span className="hero-meta-item">✓ Sin tarjeta de crédito</span>
          <span className="hero-meta-item">✓ Cancelas en 1 clic</span>
          <span className="hero-meta-item">✓ Export a Excel / CSV</span>
        </div>

        <HeroMockup />
      </div>
    </header>
  )
}

function HeroMockup() {
  return (
    <div className="hero-mockup">
      <div className="hero-mockup-bar">
        <span></span><span></span><span></span>
        <span className="hero-mockup-bar-url">amazon.com/s?k=laptops</span>
      </div>
      <div className="hero-mockup-body">
        <div className="hero-mockup-page">
          <div style={{ fontSize: 11, color: '#8b97a8', marginBottom: 10 }}>PÁGINA ACTIVA</div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '60px 1fr auto',
              gap: 12,
              padding: '12px 0',
              borderBottom: '1px solid #e4e8f0',
              alignItems: 'center',
            }}>
              <div style={{
                width: 60, height: 60, borderRadius: 8,
                background: 'linear-gradient(135deg, #f1f4f9, #e4e8f0)',
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Laptop HP Pavilion {i}5
                </div>
                <div style={{ fontSize: 11, color: '#8b97a8' }}>
                  ★ {4 + (i % 2) / 2} · En stock
                </div>
              </div>
              <div style={{ fontWeight: 700, color: '#ff9f43' }}>
                ${699 + i * 100}
              </div>
            </div>
          ))}
        </div>
        <aside className="hero-mockup-sidebar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{
              width: 18, height: 18, borderRadius: 5,
              background: 'var(--gradient-brand)', display: 'grid', placeItems: 'center',
            }}>
              <Zap size={11} fill="white" />
            </span>
            <strong style={{ fontSize: 12 }}>Thunderbit</strong>
          </div>
          <div style={{ fontSize: 10, color: '#5a6b7e', background: '#f1f4f9', padding: '5px 8px', borderRadius: 6 }}>
            🏷️ Listado de productos · 4 items
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#0d1b2a' }}>Columnas sugeridas</div>
          {['Nombre', 'Precio', 'Valoración', 'Estado', 'Imagen'].map((f) => (
            <div key={f} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 11, padding: '5px 8px',
              background: 'rgba(34, 184, 255, 0.05)',
              borderLeft: '2px solid var(--tb-cyan)',
              borderRadius: 4,
            }}>
              <span>{f}</span>
              <span style={{
                fontSize: 9, background: 'var(--gradient-brand)',
                color: 'white', padding: '1px 5px', borderRadius: 999, fontWeight: 700,
              }}>IA</span>
            </div>
          ))}
          <div style={{
            background: 'rgba(46, 229, 157, 0.1)',
            border: '1px solid rgba(46, 229, 157, 0.3)',
            padding: '8px 10px', borderRadius: 6, fontSize: 10.5, color: '#0d1b2a',
          }}>
            <strong>💰 Costo: 4 créditos</strong><br />
            <span style={{ color: '#5a6b7e' }}>Antes de scrapear, no después.</span>
          </div>
          <button style={{
            background: 'var(--gradient-brand)', color: 'white',
            padding: '8px', borderRadius: 8, fontWeight: 600, fontSize: 12,
          }}>
            Confirmar y scrapear
          </button>
        </aside>
      </div>
    </div>
  )
}

export function Features() {
  const features = [
    {
      icon: '🪄',
      title: 'Sugerencia automática de columnas',
      desc: 'La IA escanea la página y propone las columnas útiles. No necesitas tocar HTML ni selectores CSS.',
    },
    {
      icon: '💰',
      title: 'Créditos transparentes',
      desc: 'Ves el costo exacto en créditos ANTES de ejecutar el scrape. Nunca más una sorpresa en la factura.',
    },
    {
      icon: '⚡',
      title: 'Scrape en 2 clics',
      desc: 'Abre el sidebar, pulsa "Analizar página" y confirma. La IA hace todo el trabajo pesado.',
    },
    {
      icon: '🛡️',
      title: 'Anti-alucinación',
      desc: 'Cada columna trae un score de confianza. Te avisamos cuándo la IA pudo haber inferido valores.',
    },
    {
      icon: '📄',
      title: 'Export a Excel y CSV',
      desc: 'Descarga resultados en .xlsx real o CSV. Compatible con Google Sheets, Numbers y Excel.',
    },
    {
      icon: '🌐',
      title: 'Funciona en cualquier web',
      desc: 'Amazon, LinkedIn, Zillow, Google Maps, tiendas propias, sitios con login. Si lo ves, lo scrapea.',
    },
  ]

  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-head">
          <span className="section-eyebrow">Features</span>
          <h2 className="section-title">Todo lo que el original, sin las trampas</h2>
          <p className="section-sub">
            Mantenemos lo mejor de Thunderbit — sugerencia con IA, lenguaje natural,
            sidebar lateral — y arreglamos lo que más quejan los usuarios.
          </p>
        </div>
        <div className="features-grid">
          {features.map((f, i) => (
            <article key={i} className="feature-card">
              <div className="feature-icon" style={{ fontSize: 22 }}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export function HowItWorks() {
  const steps = [
    {
      n: 1,
      title: 'Navega a cualquier página',
      desc: 'Abre Amazon, LinkedIn, Zillow, una tienda propia, un listado de Google Maps… lo que quieras scrapear.',
    },
    {
      n: 2,
      title: 'Pulsa "Analizar página"',
      desc: 'La IA lee la estructura de la página y te sugiere las columnas más útiles para tu tabla. Edita lo que quieras.',
    },
    {
      n: 3,
      title: 'Confirma el costo y scrapea',
      desc: 'Ves exactamente cuántos créditos va a costar. Acepta y obtén tu Excel / CSV en segundos.',
    },
  ]

  return (
    <section className="section section-alt" id="como-funciona">
      <div className="container">
        <div className="section-head">
          <span className="section-eyebrow">Cómo funciona</span>
          <h2 className="section-title">De URL a Excel en menos de 30 segundos</h2>
        </div>
        <div className="steps">
          {steps.map((s) => (
            <div key={s.n} className="step">
              <div className="step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Comparison() {
  const rows = [
    { f: 'Sugerencia de columnas con IA', a: '✓', b: '✓' },
    { f: 'Sidebar lateral integrado', a: '✓', b: '✓' },
    { f: 'Créditos visibles ANTES del scrape', a: '✓', b: '✗' },
    { f: 'Cancelación self-service', a: '✓', b: '✗' },
    { f: 'Score de confianza por columna', a: '✓', b: '✗' },
    { f: 'Historial persistente local', a: '✓', b: '✗' },
    { f: 'Reembolsos justos', a: '✓', b: '✗' },
    { f: 'Stack open source (puedes auditarlo)', a: '✓', b: '✗' },
    { f: 'Multi-modelo IA (Claude+GPT+Gemini+GLM)', a: 'GLM', b: '✓' },
    { f: 'Plantillas preconfiguradas (100+)', a: 'Próximamente', b: '✓' },
    { f: 'Subpage scraping', a: 'Próximamente', b: '✓' },
    { f: 'Scheduled scraping', a: 'Próximamente', b: '✓' },
  ]
  return (
    <section className="section" id="comparativa">
      <div className="container">
        <div className="section-head">
          <span className="section-eyebrow">Comparativa</span>
          <h2 className="section-title">Thunderbit Clone vs. el original</h2>
          <p className="section-sub">
            Lo que mantuvimos, lo que mejoramos y lo que aún nos falta.
          </p>
        </div>
        <table className="compare-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th className="tb-col">⚡ Clone</th>
              <th>Thunderbit original</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.f}</td>
                <td className="tb-col">{r.a}</td>
                <td>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function Pricing() {
  const plans = [
    {
      name: 'Free',
      price: '$0',
      meta: '6 páginas / mes · para siempre',
      features: [
        '6 páginas scrapeadas al mes',
        'Sugerencia de columnas con IA',
        'Export CSV / Excel',
        'Email extractor',
        'Phone extractor',
        '1 scheduled scrape (diario)',
      ],
      cta: 'Empezar gratis',
      featured: false,
    },
    {
      name: 'Starter',
      price: '$9',
      meta: '500 créditos / mes · anual',
      features: [
        '500 filas al mes',
        'Subpage scraping',
        'Plantillas (próximamente)',
        'Bulk URLs (hasta 2.000)',
        'Pagination automática',
        '5 scheduled scrapes (1h)',
      ],
      cta: 'Empezar Starter',
      featured: false,
    },
    {
      name: 'Pro',
      price: '$16.50',
      meta: '3.000 créditos / mes · anual',
      features: [
        '3.000 filas al mes',
        'Todo lo de Starter',
        'Scrapers ilimitados',
        '25 scheduled scrapes (5 min)',
        'Soporte prioritario',
        'Historial extendido (1 año)',
      ],
      cta: 'Empezar Pro',
      featured: true,
    },
    {
      name: 'Business',
      price: 'Custom',
      meta: 'Créditos a medida · SSO',
      features: [
        'Volumen personalizado',
        'SSO / SAML',
        'Webhook & API access',
        'Audit logs',
        'SLA 99.9%',
        'Onboarding dedicado',
      ],
      cta: 'Hablar con ventas',
      featured: false,
    },
  ]
  return (
    <section className="section section-alt" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="section-eyebrow">Precios</span>
          <h2 className="section-title">Planes simples, sin trampas</h2>
          <p className="section-sub">
            Sin defaultear a anual. Sin dobles cargos. Cancelas en 1 clic cuando quieras.
          </p>
        </div>
        <div className="pricing-grid">
          {plans.map((p) => (
            <div key={p.name} className={`price-card ${p.featured ? 'featured' : ''}`}>
              {p.featured && <span className="price-badge">MÁS POPULAR</span>}
              <div className="price-name">{p.name}</div>
              <div className="price-amount">
                {p.price}{p.price !== 'Custom' && <small>/mes</small>}
              </div>
              <div className="price-meta">{p.meta}</div>
              <ul className="price-features">
                {p.features.map((f, i) => (
                  <li key={i}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <a href="#install" className={`price-cta ${p.featured ? 'price-cta-primary' : 'price-cta-ghost'}`}>
                {p.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Testimonials() {
  const items = [
    {
      quote: 'Por fin un scraper que no me sorprende con la factura. El estimador de créditos antes del scrape es oro puro.',
      name: 'María L.',
      role: 'E-commerce Manager',
      avatar: 'M',
    },
    {
      quote: 'Lo usé para scrapear 200 productos de un competidor en 3 minutos. La IA sugirió todas las columnas correctas.',
      name: 'Carlos R.',
      role: 'GTM Lead en SaaS startup',
      avatar: 'C',
    },
    {
      quote: 'Me encanta que pueda auditar el código. Con Thunderbit original nunca supe qué hacían con mis datos.',
      name: 'Ana T.',
      role: 'Data Analyst',
      avatar: 'A',
    },
  ]
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <span className="section-eyebrow">Testimonios</span>
          <h2 className="section-title">Lo que dicen los usuarios</h2>
        </div>
        <div className="testimonials-grid">
          {items.map((t, i) => (
            <article key={i} className="testimonial">
              <div className="testimonial-stars">★★★★★</div>
              <p className="testimonial-quote">"{t.quote}"</p>
              <div className="testimonial-author">
                <span className="testimonial-avatar">{t.avatar}</span>
                <div>
                  <div className="testimonial-name">{t.name}</div>
                  <div className="testimonial-role">{t.role}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CTA() {
  return (
    <section id="install">
      <div className="container">
        <div className="cta">
          <div className="cta-inner">
            <h2>Empieza a scrapear en 2 minutos</h2>
            <p>Descarga la extensión, instala el backend local y extrae tu primera web hoy. Gratis.</p>
            <a href="#" className="btn btn-primary btn-lg">
              <Zap size={16} fill="white" /> Añadir a Chrome
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <h3>
              <span className="nav-logo" style={{ width: 24, height: 24 }}>
                <Zap size={13} fill="white" />
              </span>
              Thunderbit Clone
            </h3>
            <p>
              Una alternativa open-source a Thunderbit, con créditos transparentes
              y respeto por el usuario. Hecho con 💚💙💛 por gente que odia las
              trampas de billing.
            </p>
          </div>
          <div className="footer-col">
            <h4>Producto</h4>
            <ul>
              <li><a href="#features">Features</a></li>
              <li><a href="#pricing">Precios</a></li>
              <li><a href="#comparativa">Comparativa</a></li>
              <li><a href="#">Changelog</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Recursos</h4>
            <ul>
              <li><a href="#">Documentación</a></li>
              <li><a href="#">Plantillas</a></li>
              <li><a href="#">API</a></li>
              <li><a href="#">Guías</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Empresa</h4>
            <ul>
              <li><a href="#">Sobre nosotros</a></li>
              <li><a href="#">Privacidad</a></li>
              <li><a href="#">Términos</a></li>
              <li><a href="#">Contacto</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Thunderbit Clone. Proyecto de demostración.</span>
          <span style={{ display: 'flex', gap: 14 }}>
            <a href="#" aria-label="GitHub"><Github size={16} /></a>
            <a href="#" aria-label="Twitter"><Twitter size={16} /></a>
          </span>
        </div>
      </div>
    </footer>
  )
}
