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

  const fieldClass =
    'bg-white/80 border-[#E4D9C7] text-[#3D3225] placeholder:text-[#6B5A45]/80 focus-visible:ring-[#C58A3D] focus-visible:border-[#C58A3D]'
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
        <div className="flex flex-col items-center mb-8">
          <picture>
            <source srcSet="/brand/tendwell-logo-black-480.webp" type="image/webp" />
            <img
              src="/brand/tendwell-logo-black-480.png"
              alt="Tendwell Cleaning Co."
              width={480}
              height={240}
              className="w-60 max-w-full h-auto"
            />
          </picture>
          <p className="mt-3 text-xs uppercase tracking-[0.2em] text-[#6B5A45]">{t('resetPassword.appTitle')}</p>
        </div>

        <div className="rounded-2xl border border-[#EDE3D3] bg-white/70 backdrop-blur-sm shadow-[0_8px_30px_rgba(61,50,37,0.10)] px-6 py-6">
          <h1 className="font-display text-2xl leading-snug text-[#22382D] mb-5">
            {phase === 'expired' ? t('resetPassword.expiredTitle') : t('resetPassword.cardTitle')}
          </h1>

          <div className="space-y-4">
            {phase === 'checking' && (
              <div className="flex justify-center py-6" data-testid="reset-checking">
                <Loader2 className="w-5 h-5 animate-spin text-[#6B5A45]" />
              </div>
            )}

            {phase === 'expired' && (
              sent ? (
                <div className="space-y-3 text-center" data-testid="text-reset-link-sent">
                  <p className="text-sm font-medium text-[#3D3225]">{t('resetPassword.newLinkSentTitle')}</p>
                  <p className="text-xs text-[#6B5A45]">
                    {t('resetPassword.newLinkSentDescription', { email: email.trim() })}
                  </p>
                  <Button
                    variant="outline"
                    className={outlineButtonClass}
                    onClick={() => window.location.replace('/')}
                    data-testid="button-back-to-signin"
                  >
                    {t('resetPassword.backToSignIn')}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSendNewLink} className="space-y-3" data-testid="form-request-new-link">
                  <p className="text-xs text-[#6B5A45] leading-relaxed">
                    {t('resetPassword.expiredDescription')}
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-email" className="text-xs text-[#5C4D3A]">{t('resetPassword.emailLabel')}</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder={t('resetPassword.emailPlaceholder')}
                      className={fieldClass}
                      data-testid="input-reset-email"
                    />
                  </div>
                  <Button
                    type="submit"
                    className={pineButtonClass}
                    disabled={sending}
                    data-testid="button-send-new-link"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : t('resetPassword.sendNewLink')}
                  </Button>
                  {sendError && (
                    <p className="text-sm text-red-700 text-center" data-testid="text-send-error">{sendError}</p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className={outlineButtonClass}
                    onClick={() => window.location.replace('/')}
                    data-testid="button-back-to-signin"
                  >
                    {t('resetPassword.backToSignIn')}
                  </Button>
                </form>
              )
            )}

            {phase === 'ready' && (done ? (
              <div className="space-y-3 text-center">
                <p className="text-sm font-medium text-[#3D3225]">{t('resetPassword.doneTitle')}</p>
                <p className="text-xs text-[#6B5A45]">{t('resetPassword.doneDescription')}</p>
                <Button className={pineButtonClass} onClick={goToSignIn} data-testid="button-back-to-signin">
                  {t('resetPassword.continueButton')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className="text-xs text-[#5C4D3A]">{t('resetPassword.newPassword')}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('resetPassword.newPasswordPlaceholder')}
                    className={fieldClass}
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-xs text-[#5C4D3A]">{t('resetPassword.confirmPassword')}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder={t('resetPassword.confirmPasswordPlaceholder')}
                    className={fieldClass}
                    data-testid="input-confirm-password"
                  />
                </div>
                <Button
                  type="submit"
                  className={pineButtonClass}
                  disabled={submitting}
                  data-testid="button-update-password"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('resetPassword.updateButton')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={outlineButtonClass}
                  onClick={goToSignIn}
                >
                  {t('resetPassword.continueButton')}
                </Button>
              </form>
            ))}

            {error && (
              <p role="alert" data-testid="text-reset-error" className="text-sm text-red-700 text-center">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
