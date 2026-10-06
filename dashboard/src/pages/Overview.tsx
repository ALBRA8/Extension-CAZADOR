import {
  Coins, Briefcase, CheckCircle2, Clock, TrendingUp, TrendingDown,
  ArrowUpRight, ExternalLink,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts'
import { mockJobs, usageData, categoryData } from '@/lib/mock-data'
import { useState } from 'react'

export function OverviewPage() {
  const recentJobs = mockJobs.slice(0, 5)

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Resumen de tu actividad de scraping en los últimos 7 días.</p>
        </div>
        <button className="btn btn-primary">
          <ZapGlyph /> Nuevo scrape
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <StatCard
          icon={<Coins size={16} />}
          label="Créditos usados (mes)"
          value="1.847"
          delta="+12%"
          deltaUp
        />
        <StatCard
          icon={<Briefcase size={16} />}
          label="Scrapes ejecutados"
          value="88"
          delta="+5"
          deltaUp
        />
        <StatCard
          icon={<CheckCircle2 size={16} />}
          label="Tasa de éxito"
          value="94,3%"
          delta="+1,2%"
          deltaUp
        />
        <StatCard
          icon={<Clock size={16} />}
          label="Tiempo medio"
          value="12,4s"
          delta="-0,8s"
          deltaUp
        />
      </div>

      {/* Charts */}
      <div className="grid-2 mb-24">
        <div className="card">
          <div className="between mb-16">
            <div className="card-title" style={{ marginBottom: 0 }}>Uso de créditos (7 días)</div>
            <span className="pill pill-info">Últimos 7 días</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={usageData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22b8ff" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#22b8ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#8b97a8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#8b97a8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid #e4e8f0',
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="credits"
                stroke="#22b8ff"
                strokeWidth={2.5}
                fill="url(#grad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Distribución por categoría</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={categoryData}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
              >
                {categoryData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 10, border: '1px solid #e4e8f0', fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {categoryData.map((c) => (
              <div key={c.name} className="between" style={{ fontSize: 12 }}>
                <span className="row">
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color }} />
                  {c.name}
                </span>
                <strong>{c.value}%</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent jobs */}
      <div className="card">
        <div className="between mb-16">
          <div className="card-title" style={{ marginBottom: 0 }}>Scrapes recientes</div>
          <button className="btn btn-ghost btn-sm">Ver todos <ArrowUpRight size={12} /></button>
        </div>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Scrape</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Filas</th>
                <th style={{ textAlign: 'right' }}>Créditos</th>
                <th style={{ textAlign: 'right' }}>Duración</th>
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.title}</div>
                    <div className="mono soft" style={{ fontSize: 11 }}>{j.url}</div>
                  </td>
                  <td>
                    {j.status === 'completed' && <span className="pill pill-success">✓ Completado</span>}
                    {j.status === 'running' && <span className="pill pill-info">● En curso</span>}
                    {j.status === 'failed' && <span className="pill pill-danger">✕ Falló</span>}
                    {j.status === 'scheduled' && <span className="pill pill-neutral">⏱ Programado</span>}
                  </td>
                  <td style={{ textAlign: 'right' }} className="mono">{j.rows}</td>
                  <td style={{ textAlign: 'right' }} className="mono">{j.credits}</td>
                  <td style={{ textAlign: 'right' }} className="mono">{j.duration}</td>
                  <td className="soft" style={{ fontSize: 12 }}>
                    {new Date(j.createdAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td>
                    <button className="btn-icon"><ExternalLink size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function StatCard({
  icon, label, value, delta, deltaUp,
}: { icon: React.ReactNode; label: string; value: string; delta: string; deltaUp?: boolean }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className={`stat-delta ${deltaUp ? 'up' : 'down'}`}>
        {deltaUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {delta} vs. semana pasada
      </div>
    </div>
  )
}

function ZapGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  )
}

// Suppress unused warning in some builds.
void useState
