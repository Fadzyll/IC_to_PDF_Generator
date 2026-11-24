// The landing page is plain HTML; this entry pulls in the shared styles and
// wires up the "Install app" button. (vite-plugin-pwa registers the service worker.)
import '../../index.css'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

const btn = document.getElementById('install-btn') as HTMLButtonElement | null
const hint = document.getElementById('install-hint')
const standalone =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

if (!standalone) {
  // Chrome/Edge/Samsung Internet: offer the browser's own install prompt.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    const event = e as InstallPromptEvent
    if (!btn) return
    btn.hidden = false
    btn.onclick = async () => {
      await event.prompt()
      btn.hidden = true
    }
  })
  // iPhone/iPad Safari has no install prompt; explain the manual way.
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios && hint) hint.hidden = false
}
