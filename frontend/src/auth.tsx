import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import type { LoginResponse, User } from './types'

interface AuthContextValue {
  user: User | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const value = localStorage.getItem('gridguard_user')
    return value ? (JSON.parse(value) as User) : null
  })

  const value = useMemo<AuthContextValue>(() => ({
    user,
    login: async (username, password) => {
      const result = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      localStorage.setItem('gridguard_token', result.access_token)
      localStorage.setItem('gridguard_user', JSON.stringify(result.user))
      setUser(result.user)
    },
    logout: () => {
      localStorage.removeItem('gridguard_token')
      localStorage.removeItem('gridguard_user')
      setUser(null)
    },
  }), [user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is missing')
  return value
}
