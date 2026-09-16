import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase, authRedirectError } from '@/lib/supabase'
import { usePageTitle } from '@/hooks/use-page-title'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

/**
 * Supabase raises this when `updateUser` is called with no session. Following a
 * dead recovery link lands here with exactly that state, and the raw string is
 * meaningless to an owner (one read it aloud as "the author is missing"), so
 * every path that produces it is rerouted to the expired-link screen.
 */
function isMissingSession(message: string): boolean {
  return /auth session missing/i.test(message) || /session[_ ]not[_ ]found/i.test(message)
}

type Phase = 'checking' | 'ready' | 'expired'

export default function ResetPasswordPage() {
  const { t } = useLocale('ownerPortal')
  usePageTitle(t('resetPassword.cardTitle'))
  const { updatePassword, logout, requestPasswordReset } = useAuth()

  // A recovery link signs the user in to a short-lived session before it ever
  // reaches this page. No session (or an error handed back on the redirect)
  // means the link was expired, already used, or never valid — so the password
  // form must not be shown at all; it can only dead-end.
  const [phase, setPhase] = useState<Phase>(authRedirectError ? 'expired' : 'checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Expired-link recovery: let them send themselves a fresh link from here
  // rather than hunting for the sign-in page's "Forgot password".
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    if (authRedirectError) return
    let cancelled = false
    // getSession() awaits auth-js's own initialization, so this resolves after
    // the recovery tokens in the URL hash have been exchanged for a session.
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setPhase(data.session ? 'ready' : 'expired')
      })
      .catch(() => {
        if (!cancelled) setPhase('expired')
      })
    return () => { cancelled = true }
  }, [])

  async function goToSignIn() {
    // App.tsx renders this page whenever the path is /reset-password, so
    // clearing the session alone leaves the user stuck here. Navigate for real.
    try { await logout() } finally { window.location.replace('/') }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t('resetPassword.tooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('resetPassword.mismatch'))
      return
    }
    setSubmitting(true)
    const { error: updErr } = await updatePassword(password)
    setSubmitting(false)
    if (updErr) {
      // The recovery session can lapse between loading the page and submitting.
      if (isMissingSession(updErr)) setPhase('expired')
      else setError(updErr)
      return
    }
    setDone(true)
  }

  async function handleSendNewLink(e: React.FormEvent) {
    e.preventDefault()
    setSendError(null)
    const trimmed = email.trim()
    if (!trimmed) {
      setSendError(t('resetPassword.emailRequired'))
      return
    }
    setSending(true)
    const { error: reqErr } = await requestPasswordReset(trimmed)
    setSending(false)
    if (reqErr) {
      setSendError(reqErr)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        <div className="flex justify-end mb-2">
          <LanguageToggle />
        </div>
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-3">
            <svg aria-label={t('resetPassword.logoAriaLabel')} viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-primary-foreground" strokeWidth="2">
              <path d="M3 9l9-6 9 6v11a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" stroke="currentColor" strokeLinejoin="round"/>
              <path d="M9 22V12h6v10" stroke="currentColor" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">{t('resetPassword.appTitle')}</h1>
        </div>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-3 pt-5 px-6">
            <p className="text-sm font-medium text-foreground">
              {phase === 'expired' ? t('resetPassword.expiredTitle') : t('resetPassword.cardTitle')}
            </p>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            {phase === 'checking' && (
              <div className="flex justify-center py-6" data-testid="reset-checking">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {phase === 'expired' && (
              sent ? (
                <div className="space-y-3 text-center" data-testid="text-reset-link-sent">
                  <p className="text-sm text-foreground">{t('resetPassword.newLinkSentTitle')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('resetPassword.newLinkSentDescription', { email: email.trim() })}
                  </p>
                  <Button variant="outline" className="w-full h-9" onClick={() => window.location.replace('/')} data-testid="button-back-to-signin">
                    {t('resetPassword.backToSignIn')}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSendNewLink} className="space-y-3" data-testid="form-request-new-link">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t('resetPassword.expiredDescription')}
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-email" className="text-xs">{t('resetPassword.emailLabel')}</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder={t('resetPassword.emailPlaceholder')}
                      data-testid="input-reset-email"
                    />
                  </div>
                  <Button type="submit" className="w-full h-9" disabled={sending} data-testid="button-send-new-link">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('resetPassword.sendNewLink')}
                  </Button>
                  {sendError && (
                    <p className="text-sm text-destructive text-center" data-testid="text-send-error">{sendError}</p>
                  )}
                  <Button type="button" variant="ghost" className="w-full h-9" onClick={() => window.location.replace('/')} data-testid="button-back-to-signin">
                    {t('resetPassword.backToSignIn')}
                  </Button>
                </form>
              )
            )}

            {phase === 'ready' && (done ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-foreground">{t('resetPassword.doneTitle')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('resetPassword.doneDescription')}
                </p>
                <Button className="w-full h-9" onClick={goToSignIn} data-testid="button-back-to-signin">
                  {t('resetPassword.continueButton')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className="text-xs">{t('resetPassword.newPassword')}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('resetPassword.newPasswordPlaceholder')}
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-xs">{t('resetPassword.confirmPassword')}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder={t('resetPassword.confirmPasswordPlaceholder')}
                    data-testid="input-confirm-password"
                  />
                </div>
                <Button type="submit" className="w-full h-9" disabled={submitting} data-testid="button-update-password">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('resetPassword.updateButton')}
                </Button>
              </form>
            ))}

            {error && (
              <p className="text-sm text-destructive text-center" data-testid="text-reset-error">{error}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
