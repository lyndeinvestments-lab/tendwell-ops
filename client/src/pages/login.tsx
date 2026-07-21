import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { LanguageToggle } from '@/components/LanguageToggle'

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
  const { t } = useLocale('authPages')
  const { loginWithGoogle, loginWithPassword, requestPasswordReset, isLoading, authError } = useAuth()

  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!email.trim() || !password) {
      setLocalError(t('errors.missingCredentials'))
      return
    }
    setSubmitting(true)
    await loginWithPassword(email, password)
    setSubmitting(false)
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!email.trim()) {
      setLocalError(t('errors.missingEmail'))
      return
    }
    setSubmitting(true)
    const { error } = await requestPasswordReset(email)
    setSubmitting(false)
    if (error) {
      setLocalError(error)
      return
    }
    // Always show success to avoid leaking which emails are registered.
    setResetSent(true)
  }

  const fieldClass =
    'bg-white/80 border-[#E4D9C7] text-[#3D3225] placeholder:text-[#8A7860]/70 focus-visible:ring-[#C58A3D] focus-visible:border-[#C58A3D]'
  const pineButtonClass =
    'w-full h-10 rounded-full bg-[#2F4A3C] text-[#FAF6EF] font-semibold tracking-wide hover:bg-[#22382D] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_6px_16px_-6px_rgba(61,50,37,0.45)] focus-visible:ring-[#C58A3D]'
  const outlineButtonClass =
    'w-full h-10 rounded-full gap-2 border-[#E4D9C7] bg-white/80 text-[#3D3225] font-medium hover:bg-white focus-visible:ring-[#C58A3D]'

  return (
    <div className="marketing-auth marketing-grain relative min-h-screen flex items-center justify-center bg-[#FAF6EF] px-4 py-10">
      <div className="absolute top-4 right-4 z-20">
        <LanguageToggle />
      </div>
      <div className="relative z-10 w-full max-w-sm">
        {/* Brand mark */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/brand/tendwell-logo-black.png"
            alt="Tendwell Cleaning Co."
            className="w-60 max-w-full h-auto"
          />
          <p className="mt-3 text-xs uppercase tracking-[0.2em] text-[#8A7860]">{t('page.caption')}</p>
        </div>

        <div className="rounded-2xl border border-[#EDE3D3] bg-white/70 backdrop-blur-sm shadow-[0_8px_30px_rgba(61,50,37,0.10)] px-6 py-6">
          <h1 className="font-display text-2xl leading-snug text-[#22382D] mb-5">
            {mode === 'forgot' ? t('page.resetHeading') : t('page.signInHeading')}
          </h1>

          <div className="space-y-4">
            {mode === 'signin' && (
              <>
                <Button
                  variant="outline"
                  className={outlineButtonClass}
                  onClick={loginWithGoogle}
                  disabled={isLoading || submitting}
                  data-testid="button-sign-in-google"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
                  {isLoading ? t('page.redirecting') : t('page.continueWithGoogle')}
                </Button>

                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-[#E4D9C7]" />
                  <span className="text-2xs uppercase tracking-wider text-[#8A7860]">{t('page.or')}</span>
                  <div className="h-px flex-1 bg-[#E4D9C7]" />
                </div>

                <form onSubmit={handlePasswordSignIn} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs text-[#5C4D3A]">{t('page.emailLabel')}</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder={t('page.emailPlaceholder')}
                      className={fieldClass}
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs text-[#5C4D3A]">{t('page.passwordLabel')}</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={fieldClass}
                      data-testid="input-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    className={pineButtonClass}
                    disabled={submitting || isLoading}
                    data-testid="button-sign-in-password"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('page.signIn')}
                  </Button>
                </form>

                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setLocalError(null) }}
                  className="text-xs text-[#2F4A3C] hover:text-[#22382D] hover:underline w-full text-center"
                  data-testid="link-forgot-password"
                >
                  {t('page.forgotPassword')}
                </button>
              </>
            )}

            {mode === 'forgot' && (
              resetSent ? (
                <div className="space-y-3 text-center">
                  <p className="text-sm font-medium text-[#3D3225]">{t('page.checkEmailTitle')}</p>
                  <p className="text-xs text-[#8A7860]">
                    {t('page.checkEmailBefore')} <span className="font-medium">{email}</span>{t('page.checkEmailAfter')}
                  </p>
                  <Button
                    variant="outline"
                    className={outlineButtonClass}
                    onClick={() => { setMode('signin'); setResetSent(false); setPassword('') }}
                  >
                    {t('page.backToSignIn')}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgot} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email" className="text-xs text-[#5C4D3A]">{t('page.emailLabel')}</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder={t('page.emailPlaceholder')}
                      className={fieldClass}
                      data-testid="input-forgot-email"
                    />
                  </div>
                  <Button
                    type="submit"
                    className={pineButtonClass}
                    disabled={submitting}
                    data-testid="button-send-reset"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('page.sendResetLink')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setMode('signin'); setLocalError(null) }}
                    className="text-xs text-[#8A7860] hover:text-[#3D3225] w-full text-center"
                  >
                    {t('page.backToSignIn')}
                  </button>
                </form>
              )
            )}

            {(authError || localError) && (
              <p data-testid="text-login-error" className="text-sm text-red-700 text-center">
                {localError || authError}
              </p>
            )}

            <p className="text-xs text-[#8A7860] text-center">
              {t('page.restrictedAccess')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
