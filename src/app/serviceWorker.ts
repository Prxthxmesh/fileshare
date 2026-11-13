type Listener = () => void;
const listeners = new Set<Listener>();
let waiting: ServiceWorker | null = null;

export function onUpdateAvailable(listener: Listener) {
  listeners.add(listener);
  if (waiting) listener();
  return () => {
    listeners.delete(listener);
  };
}

export function applyUpdate() {
  if (!waiting) {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  waiting.postMessage('skip-waiting');
}

/** Registers the app-shell service worker in production builds only. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      const notify = (sw: ServiceWorker | null) => {
        if (sw && navigator.serviceWorker.controller) {
          waiting = sw;
          listeners.forEach((l) => l());
        }
      };
      if (reg.waiting) notify(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed') notify(sw);
        });
      });
    } catch {
      // Offline support is an enhancement; the app works without it.
    }
  });
}
