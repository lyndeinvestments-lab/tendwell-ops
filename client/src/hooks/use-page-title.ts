import { useEffect } from 'react'

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | Tendwell Ops`
    return () => { document.title = 'Tendwell Ops' }
  }, [title])
}
