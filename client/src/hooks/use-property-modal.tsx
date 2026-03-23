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
