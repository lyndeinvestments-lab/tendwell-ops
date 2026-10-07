import { createContext, useContext } from 'react'

// ─── Read-only preview (admin owner emulation) ────────────────────────────────
// True while an admin is previewing the owner portal as a specific owner. Every
// section reads it to hide/disable its write affordances; the DB refuses the
// owner write RPCs while emulating regardless, so this is UX, not the guard.
export const PortalReadOnlyContext = createContext(false)
export const usePortalReadOnly = () => useContext(PortalReadOnlyContext)
