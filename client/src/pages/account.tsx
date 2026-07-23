import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { PageContainer } from '@/components/PageContainer'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { usePageTitle } from '@/hooks/use-page-title'
import { NotificationPrefs } from '@/components/NotificationPrefs'
import { useLocale } from '@/lib/i18n/LocaleProvider'
import { Globe, KeyRound, Check } from 'lucide-react'

// Personal account settings for the signed-in staff member: language,
// password (email/password accounts only — most staff sign in with Google),
// and notification preferences. Reachable by every staff member regardless
// of granted views, like the old /notifications page it absorbs. Owners have
// their own equivalents in the owner portal.
export default function AccountPage() {
  usePageTitle('My Account')
  const { t } = useLocale('account')

  return (
    <PageContainer>
      <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />
      <div className="mt-4 max-w-2xl space-y-4">
        <LanguageCard />
        <SecurityCard />
        <NotificationPrefs />
      </div>
    </PageContainer>
  )
}

function LanguageCard() {
  const { t, locale, setLocale } = useLocale('account')

  return (
    <div className="rounded-2xl border border-border shadow-sm p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('language.title')}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t('language.description')}</p>
      <div className="flex gap-2">
        {([
          { value: 'en' as const, label: 'English' },
          { value: 'es' as const, label: 'Español' },
        ]).map(opt => (
          <Button
            key={opt.value}
            variant={locale === opt.value ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setLocale(opt.value)}
            data-testid={`account-lang-${opt.value}`}
          >
            {locale === opt.value && <Check className="w-3.5 h-3.5" />}
            {opt.label}
          </Button>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground">{t('language.savedNote')}</p>
    </div>
  )
}

function SecurityCard() {
  const { t } = useLocale('account')
  const { user } = useAuth()
  const { toast } = useToast()
  // null = still resolving; false = OAuth-only (Google); true = has email/password login
  const [hasPasswordLogin, setHasPasswordLogin] = useState<boolean | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      const identities = data.user?.identities ?? []
      setHasPasswordLogin(identities.some(i => i.provider === 'email'))
    })
    return () => { cancelled = true }
  }, [user?.id])

  async function changePassword() {
    if (newPassword.length < 8) {
      toast({ title: t('security.tooShort'), variant: 'destructive' })
      return
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t('security.mismatch'), variant: 'destructive' })
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(false)
    if (error) {
      toast({ title: t('security.updateFailed'), description: error.message, variant: 'destructive' })
    } else {
      const wasFirstPassword = !hasPasswordLogin
      setNewPassword('')
      setConfirmPassword('')
      // Setting a password on a Google-only account adds an email/password
      // identity — from now on either sign-in method works.
      if (wasFirstPassword) setHasPasswordLogin(true)
      toast({ title: wasFirstPassword ? t('security.setSuccess') : t('security.updated') })
    }
  }

  return (
    <div className="rounded-2xl border border-border shadow-sm p-5 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('security.title')}</h2>
      </div>
      {hasPasswordLogin === null ? null : (
        <div className="space-y-2 max-w-sm">
          <p className="text-xs text-muted-foreground">
            {hasPasswordLogin ? t('security.description') : t('security.setDescription')}
          </p>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={t('security.newPassword')}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            data-testid="account-new-password"
          />
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={t('security.confirmPassword')}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            data-testid="account-confirm-password"
          />
          <Button size="sm" onClick={changePassword} disabled={saving || !newPassword} data-testid="account-change-password">
            {saving ? t('security.updating') : hasPasswordLogin ? t('security.updateButton') : t('security.setButton')}
          </Button>
        </div>
      )}
    </div>
  )
}
