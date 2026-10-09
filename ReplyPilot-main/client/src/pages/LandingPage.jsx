import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const ERROR_MESSAGES = {
  oauth: 'Google sign-in failed. Please try again.',
  rate_limit: 'Too many sign-in attempts. Please wait a few minutes and try again.',
}

const BACKEND_AUTH_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export default function LandingPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const errorMsg = useMemo(() => {
    const code = searchParams.get('error')
    return code ? (ERROR_MESSAGES[code] || 'Something went wrong. Please try again.') : null
  }, [searchParams])

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true })
  }, [user, loading, navigate])

  // Clear error param from URL after showing it (keeps URL clean)
  useEffect(() => {
    if (searchParams.has('error')) {
      const t = setTimeout(() => {
        searchParams.delete('error')
        setSearchParams(searchParams, { replace: true })
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [searchParams, setSearchParams])

  if (loading) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#ff4444] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0d1117] flex flex-col items-center justify-center px-4">

      {/* Glow backdrop */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#ff4444]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center max-w-md">

        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <span className="text-[#ff4444] text-4xl">▶</span>
          <span className="text-white text-3xl font-bold tracking-tight">ReplyPilot</span>
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div className="w-full mb-6 px-4 py-3 rounded-lg bg-[#ff4444]/10 border border-[#ff4444]/30 text-[#ff6b6b] text-sm text-center">
            {errorMsg}
          </div>
        )}

        {/* Headline */}
        <h1 className="text-4xl font-bold text-white mb-3 leading-tight">
          Reply to every comment,<br />
          <span className="text-[#ff4444]">at scale.</span>
        </h1>
        <p className="text-[#8b949e] text-base mb-10">
          AI-powered comment management for YouTube creators.
          Classify intent, generate replies, post — all in one place.
        </p>

        {/* Google sign in */}
        <a
          id="google-signin-btn"
          href={`${BACKEND_AUTH_URL}/api/auth/google`}
          className="flex items-center gap-3 bg-white text-gray-900 font-semibold px-6 py-3.5 rounded-xl shadow-lg hover:bg-gray-100 active:scale-95 transition-all duration-150 w-full justify-center"
        >
          {/* Google SVG */}
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </a>

        <p className="mt-5 text-xs text-[#484f58]">
          We request YouTube read + post access to manage your comments.
        </p>
      </div>
    </div>
  )
}