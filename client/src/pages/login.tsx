import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

export default function LoginPage() {
  usePageTitle('Sign In')
  const { loginWithGoogle, isLoading, authError } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        {/* Logo mark */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-3">
            <svg aria-label="Tendwell logo" viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-primary-foreground" strokeWidth="2">
              <path d="M3 9l9-6 9 6v11a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" stroke="currentColor" strokeLinejoin="round"/>
              <path d="M9 22V12h6v10" stroke="currentColor" strokeLinecap="round"/>
              <path d="M8 6.5C10 5 14 5 16 6.5" stroke="currentColor" strokeLinecap="round" opacity="0.5"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Tendwell Ops</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Operations dashboard</p>
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <p className="text-sm font-medium text-foreground">Sign in to continue</p>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            <Button
              variant="outline"
              className="w-full h-9 gap-2"
              onClick={loginWithGoogle}
              disabled={isLoading}
              data-testid="button-sign-in-google"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              {isLoading ? 'Redirecting…' : 'Continue with Google'}
            </Button>

            {authError && (
              <p data-testid="text-login-error" className="text-sm text-destructive text-center">
                {authError}
              </p>
            )}

            <p className="text-xs text-muted-foreground text-center">
              Access is restricted to invited users only.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
