import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '../lib/supabase'

/**
 * Login screen using Supabase's pre-built auth UI.
 * Only email/password — no OAuth providers.
 * After first login, the user can disable sign-ups in the Supabase dashboard
 * (Authentication → Configuration → Disable sign ups) to lock down the app.
 */
export default function AuthScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Open Brain Calendar</h1>
        <p>Sign in to access your calendar</p>
        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: '#3b82f6',
                  brandAccent: '#2563eb',
                },
                radii: {
                  borderRadiusButton: '6px',
                  inputBorderRadius: '6px',
                },
              },
            },
          }}
          providers={[]}
          localization={{
            variables: {
              sign_in: {
                email_label: 'Email',
                password_label: 'Password',
                button_label: 'Sign in',
              },
            },
          }}
        />
      </div>
    </div>
  )
}
