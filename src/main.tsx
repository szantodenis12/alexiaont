import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installCdnImageFallback } from './utils/cdn'

// Broken CDN image (stale cached 404) -> same file from Firebase Storage.
installCdnImageFallback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
