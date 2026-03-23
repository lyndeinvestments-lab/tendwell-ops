import { createContext, useContext, useState, ReactNode } from 'react'

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

  function openPropertyModal(propertyId: string, sourceContext?: string, highlightFields?: string[]) {
    setModalState({ propertyId, sourceContext, highlightFields })
    // Track recently viewed (#18)
    try {
      const prev = JSON.parse(localStorage.getItem('tendwell-recent-views') || '[]')
      const next = [propertyId, ...prev.filter((id: string) => id !== propertyId)].slice(0, 5)
      localStorage.setItem('tendwell-recent-views', JSON.stringify(next))
    } catch { /* ignore */ }
  }

  function closePropertyModal() {
    setModalState(null)
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
