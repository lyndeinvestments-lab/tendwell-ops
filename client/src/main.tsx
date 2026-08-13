import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// One-time migration from legacy hash routing: rewrite /#/foo → /foo so old
// bookmarks and emailed links land on the right page.
if (window.location.hash.startsWith("#/")) {
  const path = window.location.hash.slice(1);
  window.history.replaceState(null, "", path);
}

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for offline support.
//
// Update lifecycle (stale-app fix): a phone that keeps this app open (home
// screen web app) never reloads the page on its own, so it runs whatever
// bundle it loaded — for days or weeks. That's how devices kept the
// pre-#487/#491 code (no foreground refetch) long after the fixes shipped,
// which read as "the app never shows current data no matter what". Worse,
// when a NEW deploy's service worker finally activated, its activate handler
// deletes the OLD build's cache out from under the still-running page, so
// lazy-loaded routes started failing until a manual hard refresh.
//
// Fix, in two parts:
//  1. Actively CHECK for a new build whenever the app comes to the
//     foreground (and every 30 min while open) — registration.update()
//     re-fetches sw.js, whose per-deploy BUILD_HASH makes any new deploy
//     install immediately (its install handler calls skipWaiting).
//  2. When the new worker takes control (controllerchange), reload ONCE so
//     the page runs the bundle that matches the new cache. If the user is
//     mid-typing, defer the reload until they background the tab instead of
//     eating their input.
if ('serviceWorker' in navigator) {
  // Robust against the load event having already fired (in which case a bare
  // addEventListener('load') would never run and the SW would never register).
  const whenLoaded = (fn: () => void) => {
    if (document.readyState === 'complete') fn()
    else window.addEventListener('load', fn, { once: true })
  }
  whenLoaded(() => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const check = () => reg.update().catch(() => {})
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(check, 30 * 60_000)
    }).catch(() => {})

    // Distinguish "first SW ever installed" (no reload — the page already
    // came from the network) from "a NEW build replaced the old one".
    let hadController = !!navigator.serviceWorker.controller
    let reloaded = false
    const reloadOnce = () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true
        return
      }
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') reloadOnce()
        }, { once: true })
      } else {
        reloadOnce()
      }
    })
  })
}
