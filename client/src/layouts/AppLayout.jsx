import { Outlet, NavLink, Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { searchAll } from '../api/comments'

const nav = [
  { to: '/dashboard', icon: '📊', label: 'Dashboard' },
  { to: '/videos',    icon: '📹', label: 'Videos'    },
  { to: '/replies',   icon: '✨', label: 'Replies'   },
  { to: '/personas',  icon: '🎭', label: 'Personas'  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  // Debounced live search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      setSearchOpen(false)
      return
    }

    setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchAll(searchQuery.trim())
        setSearchResults(data)
        setSearchOpen(true)
      } catch {
        setSearchResults(null)
      } finally {
        setSearching(false)
      }
    }, 350)

    return () => clearTimeout(debounceRef.current)
  }, [searchQuery])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on navigation
  useEffect(() => {
    setSearchOpen(false)
  }, [location.pathname])

  const hasResults = searchResults && (searchResults.videos?.length > 0 || searchResults.comments?.length > 0)

  return (
    <div className="flex h-screen bg-[#0d1117] text-white overflow-hidden font-sans selection:bg-[#ff4444]/30">

      {/* ── Sidebar ── */} 
      <aside className="w-20 lg:w-60 flex flex-col bg-[#161b22] border-r border-[#30363d] shrink-0 transition-all duration-300 ease-in-out">

        {/* Logo - Now a Link to Dashboard */}
        <Link 
          to="/dashboard" 
          className="flex items-center gap-3 px-5 py-6 border-b border-[#30363d] group cursor-pointer hover:bg-[#1c2128] transition-all"
        >
          <span className="text-[#ff4444] text-2xl font-bold group-hover:rotate-[360deg] transition-transform duration-500">
            ▶
          </span>
          <span className="hidden lg:block text-white font-bold text-base tracking-tight group-hover:translate-x-1 transition-transform">
            ReplyPilot
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex flex-col gap-2 p-3 flex-1">
          {nav.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 group relative ${
                  isActive
                    ? 'bg-[#ff4444]/10 text-[#ff4444]'
                    : 'text-[#8b949e] hover:bg-[#1c2128] hover:text-white'
                }`
              }
            >
              <span className="text-lg shrink-0 group-hover:scale-125 transition-transform">{icon}</span>
              <span className="hidden lg:block">{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* ── Right column ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* TopBar */}
        <header className="h-16 flex items-center justify-between px-8 bg-[#161b22] border-b border-[#30363d] shrink-0 z-40 relative">
          
          {/* Search Bar with Live Results */}
          <div className="relative hidden md:block" ref={searchRef}>
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b949e]">
              {searching ? (
                <span className="inline-block w-4 h-4 border-2 border-[#8b949e] border-t-transparent rounded-full animate-spin" />
              ) : '🔍'}
            </span>
            <input 
              type="text"
              placeholder="Search Videos / Comments"
              className="bg-[#0d1117] border border-[#30363d] rounded-full py-1.5 pl-10 pr-4 text-sm w-80 focus:outline-none focus:border-[#ff4444] focus:ring-1 focus:ring-[#ff4444]/50 transition-all placeholder:text-[#484f58]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => { if (hasResults) setSearchOpen(true) }}
            />

            {/* Search Results Dropdown */}
            {searchOpen && searchResults && (
              <div className="absolute top-full left-0 w-80 mt-2 bg-[#0d1117] backdrop-blur-xl border border-[#484f58] rounded-xl shadow-[0_25px_80px_rgba(0,0,0,0.9)] max-h-80 overflow-y-auto z-[100] animate-in fade-in zoom-in-95 duration-200">
                {!hasResults ? (
                  <div className="px-4 py-6 text-center text-[#484f58] text-xs font-medium">
                    No results found for "{searchQuery}"
                  </div>
                ) : (
                  <>
                    {searchResults.videos?.length > 0 && (
                      <div>
                        <p className="px-4 pt-3 pb-1.5 text-[10px] font-black uppercase tracking-widest text-[#484f58]">Videos</p>
                        {searchResults.videos.map(v => (
                          <button
                            key={v.videoId}
                            onClick={() => { navigate(`/videos/${v.videoId}`); setSearchOpen(false); setSearchQuery('') }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#1c2128] transition-colors"
                          >
                            <span className="text-base">📹</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-white font-medium truncate">{v.title}</p>
                              <p className="text-[10px] text-[#484f58]">{v.viewCount?.toLocaleString() || 0} views • {v.commentCount?.toLocaleString() || 0} comments</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {searchResults.comments?.length > 0 && (
                      <div className={searchResults.videos?.length > 0 ? 'border-t border-[#30363d]' : ''}>
                        <p className="px-4 pt-3 pb-1.5 text-[10px] font-black uppercase tracking-widest text-[#484f58]">Comments</p>
                        {searchResults.comments.map(c => (
                          <button
                            key={c._id}
                            onClick={() => { navigate(`/videos/${c.videoId}`); setSearchOpen(false); setSearchQuery('') }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#1c2128] transition-colors"
                          >
                            <span className="text-base">💬</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-[#8b949e] truncate">{c.textDisplay || c.text}</p>
                              <p className="text-[10px] text-[#484f58]">by {c.authorName || 'Unknown'}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-6">
            {/* Notification Bell with Badge */}
            <button className="relative p-2 text-[#8b949e] hover:text-white transition-colors">
              🔔
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#ff4444] rounded-full border-2 border-[#161b22]" />
            </button>

            {/* User Profile Section */}
            <div className="flex items-center gap-3 pl-4 border-l border-[#30363d]">
              <div className="flex flex-col items-end hidden sm:flex">
                <span className="text-xs font-semibold text-white"> {user?.displayName || 'User'} </span>
                <span className="text-[10px] text-green-500 font-medium">Creator</span>
              </div>
              <Link to="/dashboard" className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#ff4444] to-[#ff8e8e] flex items-center justify-center text-xs font-bold border-2 border-[#30363d] cursor-pointer hover:shadow-[0_0_15px_rgba(255,68,68,0.4)] transition-all">
                {user?.avatar ? (
                  <img src={user.avatar} alt={user.displayName} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <span>{user?.displayName?.charAt(0) || 'U'}</span>
                )}
              </Link>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-8 bg-radial-gradient">
          <div className="max-w-7xl mx-auto animate-in fade-in zoom-in-95 duration-500">
            <Outlet />
          </div>
        </main>

      </div>
    </div>
  )
}