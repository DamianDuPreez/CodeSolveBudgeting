import { useState, type FormEvent } from 'react'
import logoFull from '../assets/brand/logo-full.png'
import { authErrorMessage, useAuth } from '../lib/auth'
import { Icon } from './Icon'

type Mode = 'signin' | 'signup' | 'reset'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

const COPY: Record<Mode, { title: string; sub: string; submit: string }> = {
  signin: { title: 'Welcome back', sub: 'Sign in to see where your money stands.', submit: 'Sign in' },
  signup: { title: 'Create your account', sub: 'Set up your household budget in a minute.', submit: 'Create account' },
  reset: { title: 'Reset your password', sub: 'We\'ll email you a link to choose a new one.', submit: 'Send reset link' },
}

export function LoginPage() {
  const { signIn, signUp, signInWithGoogle, resetPassword } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const switchTo = (m: Mode) => { setMode(m); setError(''); setNotice('') }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(authErrorMessage(e)) } finally { setBusy(false) }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'signup' && password.length < 8) { setError('Use a password of at least 8 characters.'); return }
    run(async () => {
      if (mode === 'signin') await signIn(email, password)
      else if (mode === 'signup') await signUp(name, email, password)
      else {
        await resetPassword(email)
        setNotice('If that email has an account, a reset link is on its way. Check your inbox.')
      }
    })
  }

  const copy = COPY[mode]

  return (
    <div className="auth">
      <section className="auth-side">
        <img src={logoFull} alt="CodeSolve" />
        <div className="tag">Budgeting</div>
        <div className="auth-quote">
          <h2>Every rand, accounted for.</h2>
          <p>Drop in your bank statement. Every transaction is read, sorted and placed in your budget for you.</p>
          <ul className="auth-points">
            <li><Icon name="check" size={16} /> Reads FNB statements: PDF, CSV and OFX</li>
            <li><Icon name="check" size={16} /> Learns your categories as you go</li>
            <li><Icon name="check" size={16} /> One shared budget for the household</li>
          </ul>
        </div>
      </section>

      <main className="auth-main">
        <div className="auth-card">
          <h1>{copy.title}</h1>
          <p>{copy.sub}</p>

          {error && <div className="auth-msg err" role="alert">{error}</div>}
          {notice && <div className="auth-msg ok" role="status">{notice}</div>}

          {mode !== 'reset' && (
            <>
              <button type="button" className="btn google-btn" disabled={busy} onClick={() => run(signInWithGoogle)}>
                <GoogleMark /> Continue with Google
              </button>
              <div className="divider">or with email</div>
            </>
          )}

          <form onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="name">Your name</label>
                <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {mode !== 'reset' && (
              <div className="field">
                <div className="field-row">
                  <label htmlFor="password">Password</label>
                  {mode === 'signin' && <button type="button" className="link-btn" onClick={() => switchTo('reset')}>Forgot password?</button>}
                </div>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
            <button type="submit" className="btn primary" disabled={busy || !email || (mode !== 'reset' && !password)}>
              {busy ? 'One moment…' : copy.submit}
            </button>
          </form>

          <div className="auth-switch">
            {mode === 'signin' && <>New here? <button className="link-btn" onClick={() => switchTo('signup')}>Create an account</button></>}
            {mode === 'signup' && <>Already have an account? <button className="link-btn" onClick={() => switchTo('signin')}>Sign in</button></>}
            {mode === 'reset' && <button className="link-btn" onClick={() => switchTo('signin')}>Back to sign in</button>}
          </div>

          <div className="auth-legal">Statements are read in your browser and never uploaded. Only the transactions are saved to your account.</div>
        </div>
      </main>
    </div>
  )
}
