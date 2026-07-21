import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { usePageTitle } from '@/hooks/use-page-title'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { LanguageToggle } from '@/components/LanguageToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function ResetPasswordPage() {
  const { t } = useLocale('ownerPortal')
  usePageTitle(t('resetPassword.cardTitle'))
  const { updatePassword, logout } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

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
      setError(updErr)
      return
    }
    setDone(true)
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
            <p className="text-sm font-medium text-foreground">{t('resetPassword.cardTitle')}</p>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-4">
            {done ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-foreground">{t('resetPassword.doneTitle')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('resetPassword.doneDescription')}
                </p>
                <Button className="w-full h-9" onClick={logout} data-testid="button-back-to-signin">
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
            )}

            {error && (
              <p className="text-sm text-destructive text-center" data-testid="text-reset-error">{error}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
