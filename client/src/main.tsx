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

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
