import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

// Deep links: `?property=<id>` on any route opens the universal property
// modal (the modal itself has a Copy-link button that produces
// /property-list?property=<id> — a page every role can access). The param is
// kept in sync via replaceState so opening/closing never adds history entries.
export function propertyDeepLink(propertyId: string): string {
  return `${window.location.origin}/property-list?property=${encodeURIComponent(propertyId)}`
}

function syncUrlParam(propertyId: string | null) {
  try {
    const url = new URL(window.location.href)
    if (propertyId) url.searchParams.set('property', propertyId)
    else url.searchParams.delete('property')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch { /* ignore */ }
}

export interface PropertyModalState {
  propertyId: string
  sourceContext?: string
  highlightFields?: string[]
}

interface PropertyModalContextType {
  modalState: PropertyModalState | null
  openPropertyModal: (propertyId: string, sourceContext?: string, highlightFields?: string[]) => void
  closePropertyModal: () => void
}

const PropertyModalContext = createContext<PropertyModalContextType | null>(null)

export function PropertyModalProvider({ children }: { children: ReactNode }) {
  const [modalState, setModalState] = useState<PropertyModalState | null>(null)

  // Open from a shared deep link on first mount.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('property')
    if (id) openPropertyModal(id, 'deep-link')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openPropertyModal(propertyId: string, sourceContext?: string, highlightFields?: string[]) {
    setModalState({ propertyId, sourceContext, highlightFields })
    syncUrlParam(propertyId)
    // Track recently viewed (#18)
    try {
      const prev = JSON.parse(localStorage.getItem('tendwell-recent-views') || '[]')
      const next = [propertyId, ...prev.filter((id: string) => id !== propertyId)].slice(0, 5)
      localStorage.setItem('tendwell-recent-views', JSON.stringify(next))
    } catch { /* ignore */ }
  }

  function closePropertyModal() {
    setModalState(null)
    syncUrlParam(null)
  }

  return (
    <PropertyModalContext.Provider value={{ modalState, openPropertyModal, closePropertyModal }}>
      {children}
    </PropertyModalContext.Provider>
  )
}

export function usePropertyModal() {
  const ctx = useContext(PropertyModalContext)
  if (!ctx) throw new Error('usePropertyModal must be used within PropertyModalProvider')
  return ctx
}
