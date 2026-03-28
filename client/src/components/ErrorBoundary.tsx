import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  resetKey?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    // Auto-reload when a lazy-loaded chunk fails (stale deployment)
    if (
      error.message?.includes('Failed to fetch dynamically imported module') ||
      error.message?.includes('Loading chunk') ||
      error.message?.includes('Loading CSS chunk')
    ) {
      // Only auto-reload once to prevent infinite loops
      const reloadKey = 'tendwell-chunk-reload'
      const lastReload = sessionStorage.getItem(reloadKey)
      const now = Date.now()
      if (!lastReload || now - Number(lastReload) > 10_000) {
        sessionStorage.setItem(reloadKey, String(now))
        window.location.reload()
        return
      }
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  render() {
    if (this.state.hasError) {
      const isChunkError = this.state.error?.message?.includes('dynamically imported module') ||
        this.state.error?.message?.includes('Loading chunk')
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive mb-4" />
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {isChunkError
              ? 'A new version was deployed. Please reload the page.'
              : (this.state.error?.message || 'An unexpected error occurred.')}
          </p>
          <Button
            variant="outline"
            onClick={() => isChunkError ? window.location.reload() : this.setState({ hasError: false, error: null })}
          >
            {isChunkError ? 'Reload page' : 'Try again'}
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
