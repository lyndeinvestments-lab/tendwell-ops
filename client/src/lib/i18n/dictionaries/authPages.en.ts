/**
 * English strings for the login surface. Stub pre-registered by the
 * account/locale infrastructure PR so the translation PR for this area only
 * touches this file pair (plus its page files) — never the shared registry.
 * Source of truth for keys; authPages.es.ts is typed `typeof authPagesEn`.
 */
// Deliberately NOT `as const` — see issues.en.ts for the parity rationale.
export const authPagesEn = {
  page: {
    caption: 'Operations',
    signInHeading: 'Sign in to continue',
    resetHeading: 'Reset your password',
    continueWithGoogle: 'Continue with Google',
    redirecting: 'Redirecting…',
    or: 'or',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    passwordLabel: 'Password',
    signIn: 'Sign in',
    forgotPassword: 'Forgot your password?',
    backToSignIn: 'Back to sign in',
    sendResetLink: 'Send reset link',
    checkEmailTitle: 'Check your email',
    checkEmailBefore: 'If an account exists for',
    checkEmailAfter: ', a password reset link is on its way.',
    restrictedAccess: 'Access is restricted to invited users and property owners.',
  },
  errors: {
    missingCredentials: 'Enter your email and password.',
    missingEmail: 'Enter your email address.',
  },
}
