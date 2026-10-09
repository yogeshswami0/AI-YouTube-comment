import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import api from '../api/axios'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchUser = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/auth/user')
      setUser(res.data.data)
      setError(null)
    } catch (err) {
      if (err.response?.status === 401) {
        setUser(null)
      } else {
        setError(err.message || 'Failed to fetch user')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  // Use useMemo to prevent unnecessary re-renders of all consumers
  const value = useMemo(() => ({
    user,
    loading,
    error,
    updateUser: setUser, // simplified
    refreshUser: fetchUser,
    isAuthenticated: !!user
  }), [user, loading, error, fetchUser])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}