import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LoginPage } from './components/LoginPage'
import { AuthProvider, useAuth } from './lib/auth'
import { isFirebaseConfigured } from './lib/firebase'
import { startSync } from './lib/sync'

function Loading({ text }: { text?: string }) {
  return <div className="boot" aria-busy="true">{text && <span>{text}</span>}</div>
}

/** Loads the household's data into this browser before showing the app. */
function Synced({ householdId }: { householdId: string }) {
  const [ready, setReady] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    startSync(householdId)
      .then(() => { if (live) setReady(householdId) })
      .catch((e) => { console.error(e); if (live) setFailed(true) })
    return () => { live = false }
  }, [householdId])
  if (failed) return <Loading text="Couldn't load your budget. Check your connection and refresh the page." />
  return ready === householdId ? <App /> : <Loading text="Loading your budget…" />
}

/** With Firebase set up, the app sits behind sign-in. Without it, it runs locally with no account. */
function Gate() {
  const { user, profile } = useAuth()
  if (user === undefined) return <Loading />
  if (!user) return <LoginPage />
  if (!profile) return <Loading text="Setting up your account…" />
  return <Synced householdId={profile.householdId} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isFirebaseConfigured ? <AuthProvider><Gate /></AuthProvider> : <App />}
  </StrictMode>,
)
