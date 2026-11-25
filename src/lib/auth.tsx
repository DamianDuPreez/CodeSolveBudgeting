import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { clearIndexedDbPersistence, doc, getDoc, serverTimestamp, setDoc, terminate, writeBatch } from 'firebase/firestore'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth, firestore } from './firebase'
import { stopSync } from './sync'

export interface Profile {
  name: string
  email: string
  householdId: string
}

interface AuthState {
  /** undefined while Firebase is still checking whether someone is signed in. */
  user: User | null | undefined
  profile: Profile | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/** First sign-in: create the person's profile and their own household (shared budget). */
async function ensureProfile(user: User): Promise<Profile> {
  if (!firestore) throw new Error('Firebase is not configured')
  const ref = doc(firestore, 'users', user.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data() as Profile

  const name = user.displayName || user.email?.split('@')[0] || 'You'
  const householdRef = doc(firestore, 'households', user.uid)
  const profile: Profile = { name, email: user.email ?? '', householdId: householdRef.id }
  const batch = writeBatch(firestore)
  batch.set(householdRef, { name: `${name}'s household`, owner: user.uid, members: [user.uid], createdAt: serverTimestamp() })
  batch.set(ref, { ...profile, createdAt: serverTimestamp() })
  await batch.commit()
  return profile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(auth ? undefined : null)
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        try { setProfile(await ensureProfile(u)) } catch (e) { console.error('Could not load profile', e) }
      } else {
        setProfile(null)
      }
      setUser(u)
    })
  }, [])

  const need = () => { if (!auth) throw new Error('Firebase is not configured'); return auth }

  const value: AuthState = {
    user,
    profile,
    signIn: async (email, password) => { await signInWithEmailAndPassword(need(), email.trim(), password) },
    signUp: async (name, email, password) => {
      const cred = await createUserWithEmailAndPassword(need(), email.trim(), password)
      if (name.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() })
        // onAuthStateChanged may have run before the name was set; write it now.
        if (firestore) await setDoc(doc(firestore, 'users', cred.user.uid), { name: name.trim() }, { merge: true })
        setProfile((p) => (p ? { ...p, name: name.trim() } : p))
      }
    },
    signInWithGoogle: async () => {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(need(), provider)
    },
    resetPassword: async (email) => { await sendPasswordResetEmail(need(), email.trim()) },
    signOut: async () => {
      await stopSync()
      await fbSignOut(need())
      // Also clear Firebase's offline copy, so nothing is left behind on a shared computer.
      if (firestore) {
        await terminate(firestore)
        await clearIndexedDbPersistence(firestore).catch(() => {})
      }
      location.reload()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Turns Firebase error codes into sentences people understand. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password don\'t match an account.'
    case 'auth/invalid-email': return 'That email address doesn\'t look right.'
    case 'auth/email-already-in-use': return 'There is already an account with that email. Sign in instead.'
    case 'auth/weak-password': return 'Use a password of at least 8 characters.'
    case 'auth/too-many-requests': return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed': return 'No connection. Check your internet and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return ''
    case 'auth/popup-blocked': return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.'
    case 'auth/operation-not-allowed': return 'This sign-in method isn\'t switched on in Firebase yet.'
    case 'auth/unauthorized-domain': return 'This web address isn\'t allowed to sign in yet. Add it under Firebase → Authentication → Settings → Authorised domains.'
    default: return 'Something went wrong. Please try again.'
  }
}
