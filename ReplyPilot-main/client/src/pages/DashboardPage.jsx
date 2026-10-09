import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import api from '../api/axios'

// ── Format large numbers ───────────────────────────────────────────────────
function fmt(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

// ── Stat card with Hover Glow ──────────────────────────────────────────────
function StatCard({ label, value, icon, index }) {
  return (
    <div 
      className={`bg-[#161b22]/70 backdrop-blur-sm border border-[#30363d] rounded-2xl p-6 flex items-center gap-4 hover:border-[#ff4444]/50 hover:shadow-[0_0_20px_rgba(255,68,68,0.1)] transition-all duration-300 group animate-in fade-in slide-in-from-bottom-4 fill-mode-both`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="w-12 h-12 rounded-xl bg-[#0d1117] flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div>
        <p className="text-[#8b949e] text-[10px] font-bold uppercase tracking-[0.15em]">{label}</p>
        <p className="text-white text-2xl font-black mt-0.5 tracking-tight">{value}</p>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user, updateUser } = useAuth()
  const navigate = useNavigate()

  const [channel, setChannel] = useState(null)
  const [channelLoading, setChannelLoading] = useState(false)
  const [channelError, setChannelError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    if (user) {
      if (user.channelId) { loadChannel(false) } 
      else { linkChannel() }
    }
  }, [user])

  async function loadChannel(force) {
    try {
      force ? setSyncing(true) : setChannelLoading(true)
      const res = await api.get('/api/channel', { params: force ? { force: 'true' } : {} })
      setChannel(res.data.data)
      setChannelError(null)
    } catch (err) {
      setChannelError('Could not load YouTube channel data.')
    } finally {
      setChannelLoading(false)
      setSyncing(false)
    }
  }

  async function linkChannel() {
    try {
      setLinking(true)
      setChannelError(null)
      const res = await api.get('/api/channel')
      setChannel(res.data.data)
    } catch (err) {
      setChannelError(err.response?.status === 404 ? 'No channel found.' : 'Failed to link channel.')
    } finally {
      setLinking(false)
    }
  }

  async function handleLogout() {
    try {
      await api.post('/api/auth/logout')
      updateUser(null)
      navigate('/', { replace: true })
    } catch (err) {
      console.error('Logout failed', err)
    }
  }

  if (!user) return null

  return (
    <div className="relative min-h-full pb-12">
      {/* ── Background Decoration ── */}
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#ff4444]/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 -left-24 w-72 h-72 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-5xl mx-auto flex flex-col gap-8 relative z-10 animate-in fade-in duration-700">

        {/* ── Page Header ── */}
        <div className="flex items-end justify-between border-b border-[#30363d]/50 pb-6">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">System <span className="text-[#ff4444]">Overview</span></h1>
            <p className="text-[#8b949e] text-base mt-1">
              Welcome back, <span className="text-white font-medium">{user?.displayName || 'Creator'}</span>. Everything looks good.
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs font-bold text-[#8b949e] hover:text-white uppercase tracking-widest border border-[#30363d] hover:bg-white/5 px-6 py-2.5 rounded-full transition-all active:scale-95"
          >
            Sign out
          </button>
        </div>

        {/* ── Profile & Channel Status ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* User Profile Info */}
          <div className="lg:col-span-2 bg-gradient-to-br from-[#1c2128] to-[#161b22] border border-[#30363d] rounded-3xl p-8 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
            <div className="relative">
              {user?.avatar ? (
                <img src={user.avatar} alt="Avatar" className="w-24 h-24 rounded-2xl object-cover ring-4 ring-[#ff4444]/20 group-hover:ring-[#ff4444]/40 transition-all duration-500" />
              ) : (
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#ff4444] to-[#800000] flex items-center justify-center text-3xl font-bold">
                  {user?.displayName?.[0]}
                </div>
              )}
              <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-green-500 border-4 border-[#1c2128] rounded-full animate-pulse" title="Online" />
            </div>

            <div className="flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold text-white">{user?.displayName}</h2>
              <p className="text-[#8b949e]">{user?.email}</p>
              
              <div className="flex items-center justify-center md:justify-start gap-3 mt-4">
                {linking ? (
                  <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-tighter border border-blue-500/20 animate-pulse">Linking...</span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-400 text-[10px] font-bold uppercase tracking-tighter border border-green-500/20">Verified Partner</span>
                )}
                {user?.createdAt && (
                  <span className="text-[10px] text-[#484f58] font-bold uppercase tracking-widest">Est. {new Date(user.createdAt).getFullYear()}</span>
                )}
              </div>
            </div>
          </div>

          {/* Sync Box */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-3xl p-8 flex flex-col items-center justify-center text-center gap-4">
            <p className="text-[#8b949e] text-xs font-bold uppercase tracking-widest">Data Synchronization</p>
            <button
              onClick={() => loadChannel(true)}
              disabled={syncing}
              className={`w-full py-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-3 ${
                syncing ? 'bg-white/5 text-white' : 'bg-[#ff4444] hover:bg-[#ff6666] text-white shadow-lg shadow-[#ff4444]/20'
              }`}
            >
              <span className={syncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}>↻</span>
              {syncing ? 'UPDATING...' : 'SYNC DATA'}
            </button>
            <p className="text-[10px] text-[#484f58]">Last updated: {new Date().toLocaleTimeString()}</p>
          </div>
        </div>

        {/* ── Channel Stats Section ── */}
        {channel && !channelLoading && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-1000">
             <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#30363d] to-transparent"></div>
                <span className="text-[#8b949e] text-[10px] font-bold uppercase tracking-[0.3em]">Channel Metrics</span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#30363d] to-transparent"></div>
             </div>

             <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard index={0} label="Audience" value={channel.hiddenSubscriberCount ? 'HIDDEN' : fmt(channel.subscriberCount)} icon="👥" />
                <StatCard index={1} label="Reach" value={fmt(channel.viewCount)} icon="👁️" />
                <StatCard index={2} label="Library" value={fmt(channel.videoCount)} icon="🎬" />
                <StatCard index={3} label="Tags" value={channel.keywords?.length || '0'} icon="🏷️" />
             </div>
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <button
            onClick={() => navigate('/videos')}
            className="group relative bg-[#161b22] border border-[#30363d] hover:border-[#ff4444]/50 rounded-3xl p-8 text-left transition-all overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-8 text-6xl opacity-10 group-hover:opacity-20 transition-opacity group-hover:scale-125 duration-500">📹</div>
            <p className="text-[#ff4444] text-xs font-black uppercase tracking-widest mb-2">Content Hub</p>
            <p className="text-white text-2xl font-bold">Manage Videos</p>
            <p className="text-[#8b949e] text-sm mt-2 max-w-[200px]">Review comments and deploy AI-assisted replies.</p>
          </button>

          <button
            onClick={() => navigate('/personas')}
            className="group relative bg-[#161b22] border border-[#30363d] hover:border-blue-500/50 rounded-3xl p-8 text-left transition-all overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-8 text-6xl opacity-10 group-hover:opacity-20 transition-opacity group-hover:scale-125 duration-500">🎭</div>
            <p className="text-blue-400 text-xs font-black uppercase tracking-widest mb-2">Identity Core</p>
            <p className="text-white text-2xl font-bold">Configure Personas</p>
            <p className="text-[#8b949e] text-sm mt-2 max-w-[200px]">Fine-tune the vocabulary and behavior of your AI.</p>
          </button>
        </div>
      </div>
    </div>
  )
}