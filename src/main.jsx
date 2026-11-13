import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { SPRINGS, springEasing } from './lib/spring.js'

// Real spring curves for CSS (styles.css keeps cubic-bezier fallbacks for
// browsers without linear(), i.e. before iOS 17.2).
if (window.CSS?.supports?.('transition-timing-function', 'linear(0, 1)')) {
  const root = document.documentElement.style
  root.setProperty('--spring', springEasing(SPRINGS.smooth).easing)
  root.setProperty('--spring-snappy', springEasing(SPRINGS.snappy).easing)
  root.setProperty('--spring-bouncy', springEasing(SPRINGS.bouncy).easing)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
