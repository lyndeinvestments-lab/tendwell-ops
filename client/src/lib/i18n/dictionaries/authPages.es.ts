import type { authPagesEn } from './authPages.en'

/** Spanish (Latin American) strings for the login surface. */
export const authPagesEs: typeof authPagesEn = {
  page: {
    caption: 'Operaciones',
    signInHeading: 'Inicia sesión para continuar',
    resetHeading: 'Restablece tu contraseña',
    continueWithGoogle: 'Continuar con Google',
    redirecting: 'Redirigiendo…',
    or: 'o',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    passwordLabel: 'Contraseña',
    signIn: 'Iniciar sesión',
    forgotPassword: '¿Olvidaste tu contraseña?',
    backToSignIn: 'Volver a iniciar sesión',
    sendResetLink: 'Enviar enlace de restablecimiento',
    checkEmailTitle: 'Revisa tu correo',
    checkEmailBefore: 'Si existe una cuenta para',
    checkEmailAfter: ', un enlace para restablecer la contraseña está en camino.',
    restrictedAccess: 'El acceso está restringido a usuarios invitados y propietarios.',
  },
  errors: {
    missingCredentials: 'Ingresa tu correo electrónico y contraseña.',
    missingEmail: 'Ingresa tu dirección de correo electrónico.',
  },
}
