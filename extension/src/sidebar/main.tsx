import React from 'react'
import ReactDOM from 'react-dom/client'
import { Sidebar } from './Sidebar'
import '@/styles/globals.css'
import '@/styles/components.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sidebar />
  </React.StrictMode>,
)
