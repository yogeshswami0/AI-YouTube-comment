import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getVideos } from '../api/channel'

// ── Format large numbers ───────────────────────────────────────────────────
function fmt(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days < 1)   return 'Today'
  if (days < 7)   return `${days}d ago`
  if (days < 30)  return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function SkeletonCard() {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-video bg-[#1c2128]" />
      <div className="p-5 flex flex-col gap-3">
        <div className="h-4 bg-[#1c2128] rounded-full w-3/4" />
        <div className="h-3 bg-[#1c2128] rounded-full w-1/4" />
        <div className="flex gap-4 mt-2">
          <div className="h-4 bg-[#1c2128] rounded-full w-12" />
          <div className="h-4 bg-[#1c2128] rounded-full w-12" />
        </div>
      </div>
    </div>
  )
}

function VideoCard({ video, onClick, index }) {
  const thumb =
    video.thumbnail?.maxres   || video.thumbnails?.maxres?.url   ||
    video.thumbnail?.high     || video.thumbnails?.high?.url     ||
    video.thumbnail?.medium   || video.thumbnails?.medium?.url   ||
    video.thumbnail?.default  || video.thumbnails?.default?.url  ||
    null

  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${index * 50}ms` }}
      className="group relative bg-[#161b22]/40 backdrop-blur-sm border border-[#30363d] hover:border-[#ff4444]/50 rounded-2xl overflow-hidden text-left transition-all duration-300 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:-translate-y-1.5 animate-in fade-in slide-in-from-bottom-4 fill-mode-both"
    >
      <div className="relative aspect-video bg-[#0d1117] overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt={video.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-[#1c2128] to-[#0d1117]">🎬</div>
        )}
        
        {/* Play Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
             <div className="w-12 h-12 bg-[#ff4444] rounded-full flex items-center justify-center shadow-xl scale-75 group-hover:scale-100 transition-transform duration-300">
                <span className="text-white text-xl">▶</span>
             </div>
        </div>

        {video.duration && (
          <span className="absolute bottom-3 right-3 bg-black/80 backdrop-blur-md text-white text-[10px] px-2 py-0.5 rounded font-bold tracking-widest uppercase">
            {video.duration}
          </span>
        )}
      </div>

      <div className="p-5">
        <p className="text-white text-[15px] font-bold line-clamp-2 leading-tight group-hover:text-[#ff4444] transition-colors duration-300">
          {video.title || 'Untitled'}
        </p>
        
        <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-wider text-[#8b949e]">
              <span className="flex items-center gap-1.5" title="Views">
                <span className="text-[#ff4444]">👁</span> {fmt(video.viewCount)}
              </span>
              <span className="flex items-center gap-1.5" title="Comments">
                <span className="text-[#ff4444]">💬</span> {fmt(video.commentCount)}
              </span>
              {video.likeCount != null && (
                <span className="flex items-center gap-1.5" title="Likes">
                  <span className="text-[#ff4444]">👍</span> {fmt(video.likeCount)}
                </span>
              )}
            </div>
            <span className="text-[#484f58] text-[10px] font-bold uppercase">{timeAgo(video.publishedAt)}</span>
        </div>
      </div>
    </button>
  )
}

export default function VideosPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [videos, setVideos]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [search, setSearch]   = useState(searchParams.get('search') || '')
  const [sortBy, setSortBy]   = useState('date') 
  const [syncing, setSyncing] = useState(false)

  function fetchVideos(force = false) {
    force ? setSyncing(true) : setLoading(true)
    setError(null)
    getVideos(force ? { sync: 'true' } : {})
      .then(data => {
        const list = Array.isArray(data) ? data : (data.items ?? data.data ?? data.videos ?? [])
        setVideos(list)
      })
      .catch(err => {
        const msg = err.response?.data?.message || err.response?.data?.error
        setError(msg || 'Failed to load videos.')
      })
      .finally(() => { setLoading(false); setSyncing(false) })
  }

  useEffect(() => { fetchVideos() }, [])

  useEffect(() => {
    setSearch(searchParams.get('search') || '')
  }, [searchParams])

  const filtered = useMemo(() => {
    let list = [...videos]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(v => v.title?.toLowerCase().includes(q))
    }
    if (sortBy === 'views')    list.sort((a, b) => (b.viewCount    ?? 0) - (a.viewCount    ?? 0))
    if (sortBy === 'comments') list.sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0))
    if (sortBy === 'date')     list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    return list
  }, [videos, search, sortBy])

  return (
    <div className="flex flex-col gap-8 relative min-h-screen pb-20">
      
      {/* Background Accent */}
      <div className="absolute -top-20 right-0 w-80 h-80 bg-[#ff4444]/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[#30363d]/50 pb-8">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tight">Content <span className="text-[#ff4444]">Library</span></h1>
          <p className="text-[#8b949e] font-medium mt-1">
            {loading ? 'Fetching your data...' : `Managing ${videos.length} videos across your channel.`}
          </p>
        </div>
        
        <button
          onClick={() => fetchVideos(true)}
          disabled={syncing || loading}
          className="group flex items-center gap-3 bg-white/5 hover:bg-white/10 text-white border border-[#30363d] px-6 py-3 rounded-2xl transition-all active:scale-95 disabled:opacity-40 shadow-xl"
        >
          <span className={`text-lg ${syncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`}>↻</span>
          <span className="text-xs font-black uppercase tracking-widest">{syncing ? 'Syncing...' : 'Sync YouTube'}</span>
        </button>
      </div>

      {/* Controls: Search & Sort */}
      <div className="flex flex-col lg:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl opacity-50">🔍</span>
          <input
            type="text"
            placeholder="Search by title..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#161b22]/50 backdrop-blur-sm border border-[#30363d] focus:border-[#ff4444] focus:ring-1 focus:ring-[#ff4444]/20 rounded-2xl pl-12 pr-6 py-4 text-sm text-white placeholder:text-[#484f58] transition-all outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-[#161b22]/80 backdrop-blur-sm border border-[#30363d] rounded-2xl p-1.5 self-stretch lg:self-auto">
          {[
            { key: 'date',     label: 'Newest'   },
            { key: 'views',    label: 'Views'    },
            { key: 'comments', label: 'Comments' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
                sortBy === key
                  ? 'bg-[#ff4444] text-white shadow-lg shadow-[#ff4444]/20'
                  : 'text-[#8b949e] hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/5 border border-red-500/20 text-red-400 rounded-2xl px-6 py-4 text-sm font-medium">
          ⚠️ {error}
        </div>
      )}

      {/* Grid Section */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 bg-[#161b22] rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-2xl">📭</div>
          <p className="text-white font-black text-2xl tracking-tight">Zero matches found</p>
          <p className="text-[#8b949e] font-medium mt-2 max-w-xs mx-auto">Try adjusting your filters or search keywords.</p>
          {search && (
            <button onClick={() => setSearch('')} className="mt-6 text-[#ff4444] font-bold text-xs uppercase tracking-widest hover:underline">Clear Filters</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {filtered.map((video, idx) => (
            <VideoCard
              key={video.videoId ?? video.id}
              index={idx}
              video={video}
              onClick={() => navigate(`/videos/${video.videoId ?? video.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}