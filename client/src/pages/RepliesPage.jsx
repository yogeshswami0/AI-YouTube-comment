import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getVideos } from '../api/channel'
import { listReplies, approveReply, rejectReply, publishReply, publishBatch, editReply, regenerateReply, deleteReply } from '../api/replies'

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  pending_review: { label: 'Pending', bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20', dot: 'bg-amber-500' },
  approved:       { label: 'Approved',   bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-500' },
  rejected:       { label: 'Rejected',   bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/20', dot: 'bg-rose-500' },
  publishing:     { label: 'Publishing', bg: 'bg-sky-500/10',   text: 'text-sky-400',   border: 'border-sky-500/20', dot: 'bg-sky-500' },
  published:      { label: 'Published',  bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20', dot: 'bg-indigo-500' },
  failed:         { label: 'Failed',     bg: 'bg-rose-500/10',   text: 'text-rose-600',   border: 'border-rose-500/20', dot: 'bg-rose-600' },
}

const TONE_EMOJI = {
  friendly: '😊', professional: '💼', humorous: '😄', promotional: '📢',
  appreciative: '🙏', informative: 'ℹ️', supportive: '🤝', apologetic: '😔', neutral: '😐',
  romantic: '💕', rude: '💀', crazy: '🤪',
}

const STATUS_FILTERS = [
  { key: 'all',            label: 'All'      },
  { key: 'pending_review', label: 'Pending'  },
  { key: 'approved',       label: 'Approved' },
  { key: 'rejected',       label: 'Rejected' },
  { key: 'published',      label: 'Published'},
]

// ── Skeleton ──────────────────────────────────────────────────────────────────
function ReplySkeleton() {
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-2xl p-6 animate-pulse">
      <div className="flex justify-between mb-6">
        <div className="flex gap-3">
          <div className="h-5 bg-[#1c2128] rounded-md w-32" />
          <div className="h-5 bg-[#1c2128] rounded-full w-20" />
        </div>
        <div className="h-4 bg-[#1c2128] rounded w-24" />
      </div>
      <div className="space-y-3 mb-6">
        <div className="h-4 bg-[#1c2128] rounded w-full" />
        <div className="h-4 bg-[#1c2128] rounded w-5/6" />
      </div>
      <div className="flex gap-3">
        <div className="h-9 bg-[#1c2128] rounded-lg w-24" />
        <div className="h-9 bg-[#1c2128] rounded-lg w-24" />
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending_review
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full border font-semibold tracking-wide uppercase ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

// ── Reply card ────────────────────────────────────────────────────────────────
function ReplyCard({ reply, selected, onToggleSelect, onUpdate, onDelete }) {
  const [loading,   setLoading]   = useState(null)
  const [status,    setStatus]    = useState(reply.status)
  const [editing,   setEditing]   = useState(false)
  const [editText,  setEditText]  = useState(reply.finalText || reply.editedText || reply.generatedText || '')
  const [error,     setError]     = useState(null)
  const [showFull,  setShowFull]  = useState(false)

  const comment     = reply.commentId
  const displayText = reply.finalText || reply.editedText || reply.generatedText || ''
  const commentText = comment?.textDisplay || comment?.text || ''

  async function handleApprove() {
    setLoading('approve'); setError(null)
    try {
      await approveReply(reply._id)
      setStatus('approved')
      onUpdate(reply._id, 'approved')
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to approve')
    } finally { setLoading(null) }
  }

  async function handleReject() {
    setLoading('reject'); setError(null)
    try {
      await rejectReply(reply._id)
      setStatus('rejected')
      onUpdate(reply._id, 'rejected')
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to reject')
    } finally { setLoading(null) }
  }

  async function handlePublish() {
    setLoading('publish'); setError(null)
    try {
      await publishReply(reply._id)
      setStatus('publishing')
      onUpdate(reply._id, 'publishing')
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to publish')
    } finally { setLoading(null) }
  }

  async function handleEdit() {
    if (!editText.trim()) return
    setLoading('edit'); setError(null)
    try {
      const res = await editReply(reply._id, editText)
      setEditing(false)
      onUpdate(reply._id, status, res.data?.finalText ?? editText)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save edit')
    } finally { setLoading(null) }
  }

  async function handleRegenerate() {
    setLoading('regen'); setError(null)
    try {
      const res = await regenerateReply(reply._id)
      const newText = res.data?.finalText || res.data?.generatedText || ''
      setEditText(newText)
      setStatus('pending_review')
      onUpdate(reply._id, 'pending_review', newText)
    } catch (e) {
      setError(e.response?.data?.error || 'AI service may be offline')
    } finally { setLoading(null) }
  }

  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleDelete() {
    setConfirmDelete(false)
    setLoading('delete'); setError(null)
    try {
      await deleteReply(reply._id)
      onDelete(reply._id)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete')
      setLoading(null)
    }
  }

  const isLocked = ['published', 'publishing'].includes(status)

  return (
    <div className={`group bg-[#0d1117] border rounded-2xl p-6 transition-all duration-300 shadow-sm hover:shadow-md ${
      status === 'approved'  ? 'border-emerald-500/30'  :
      status === 'rejected'  ? 'border-rose-500/20'    :
      status === 'published' ? 'border-indigo-500/30' :
      'border-[#30363d] hover:border-[#444c56]'
    }`}>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {!isLocked && (
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all cursor-pointer ${
                selected ? 'bg-[#ff4444] border-[#ff4444]' : 'border-[#484f58] hover:border-[#8b949e]'
              }`}
              onClick={(e) => { e.stopPropagation(); onToggleSelect && onToggleSelect(reply._id); }}
            >
              {selected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
          )}
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center text-xs font-bold text-white uppercase">
            {comment?.authorName?.charAt(0) || '?'}
          </div>
          <div className="flex flex-col">
            <span className="text-gray-100 text-sm font-bold leading-tight">
              {comment?.authorName || 'Unknown'}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={status} />
              {reply.tone && (
                <span className="text-[11px] text-[#8b949e] flex items-center gap-1 bg-[#161b22] px-2 py-0.5 rounded-md border border-[#30363d]">
                  {TONE_EMOJI[reply.tone]} {reply.tone}
                </span>
              )}
            </div>
          </div>
        </div>
        <time className="text-[11px] text-[#484f58] font-medium">
          {new Date(reply.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>

      {/* Content Stack */}
      <div className="space-y-4">
        {/* Original comment */}
        <div className="relative pl-4 border-l-2 border-[#30363d]">
          <p className="text-[10px] text-[#484f58] font-bold uppercase tracking-widest mb-1">Incoming</p>
          <p className={`text-[#8b949e] text-[13px] leading-relaxed ${!showFull && 'line-clamp-2'}`}>
            {commentText || '—'}
          </p>
          {commentText.length > 120 && (
            <button
              onClick={() => setShowFull(p => !p)}
              className="text-[11px] text-blue-400 hover:text-blue-300 mt-1 font-medium transition-colors"
            >
              {showFull ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>

        {/* Generated reply */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 transition-colors group-hover:bg-[#1c2128]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] text-amber-500/80 font-bold uppercase tracking-widest flex items-center gap-1.5">
              <span className="text-xs">✨</span> AI Response {reply.editedText && <span className="text-[#ff4444] lowercase font-normal">(edited)</span>}
            </p>
          </div>

          {editing ? (
            <div className="space-y-3">
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={4}
                className="w-full bg-[#0d1117] border border-[#ff4444]/40 focus:border-[#ff4444] focus:ring-1 focus:ring-[#ff4444] focus:outline-none rounded-lg px-3 py-2.5 text-sm text-white resize-none transition-all"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleEdit}
                  disabled={loading === 'edit'}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs bg-[#ff4444] hover:bg-[#ee3333] text-white px-4 py-2 rounded-lg font-bold transition-all disabled:opacity-50"
                >
                  {loading === 'edit' ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Save Changes'}
                </button>
                <button
                  onClick={() => { setEditing(false); setEditText(displayText) }}
                  className="flex-1 sm:flex-none text-xs text-[#8b949e] hover:text-white px-4 py-2 rounded-lg border border-[#30363d] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
              {displayText || <span className="text-[#484f58] italic">No reply text</span>}
            </p>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-4 p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg">
           <p className="text-xs text-rose-400 text-center font-medium">{error}</p>
        </div>
      )}

      {/* Actions */}
      {!isLocked && !editing && (
        <div className="flex items-center gap-2 flex-wrap mt-6 pt-5 border-t border-[#30363d]">
          {status !== 'approved' && (
            <button
              onClick={handleApprove}
              disabled={!!loading}
              className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-500 px-4 py-2 rounded-lg transition-all font-bold border border-emerald-500/20 disabled:opacity-40"
            >
              {loading === 'approve' ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : 'Approve'}
            </button>
          )}

          {status !== 'rejected' && (
            <button
              onClick={handleReject}
              disabled={!!loading}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-500 px-4 py-2 rounded-lg transition-all font-bold border border-rose-500/20 disabled:opacity-40"
            >
              {loading === 'reject' ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : 'Reject'}
            </button>
          )}

          {status === 'rejected' && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={!!loading}
              title="Delete reply"
              className="flex items-center justify-center w-8 h-8 text-rose-400 hover:text-white hover:bg-rose-600 rounded-lg transition-all disabled:opacity-40"
            >
              {loading === 'delete' ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
            </button>
          )}

          <button
            onClick={handlePublish}
            disabled={!!loading || status === 'rejected'}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-white bg-blue-500/10 hover:bg-blue-500 px-4 py-2 rounded-lg transition-all font-bold border border-blue-500/20 disabled:opacity-40"
          >
            {loading === 'publish' ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : 'Publish'}
          </button>

          <div className="flex-1 h-px" /> {/* Spacer */}

          <button
            onClick={() => setEditing(true)}
            disabled={!!loading}
            className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-white bg-[#1c2128] border border-[#30363d] px-4 py-2 rounded-lg transition-all font-bold disabled:opacity-40"
          >
            Edit
          </button>

          <button
            onClick={handleRegenerate}
            disabled={!!loading}
            className="flex items-center gap-1.5 text-xs text-[#8b949e] hover:text-white bg-[#1c2128] border border-[#30363d] px-4 py-2 rounded-lg transition-all font-bold disabled:opacity-40"
          >
            {loading === 'regen' ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : 'Regenerate'}
          </button>
        </div>
      )}

      {isLocked && (
        <div className="mt-6 pt-4 border-t border-[#30363d] flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full animate-pulse ${status === 'published' ? 'bg-indigo-500' : 'bg-sky-500'}`} />
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#484f58]">
            {status === 'published' ? 'Synced with YouTube' : 'Syncing to YouTube…'}
          </p>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setConfirmDelete(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-[#161b22] border border-[#30363d] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">Delete Reply</h3>
                <p className="text-[#8b949e] text-xs">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-[#8b949e] text-xs leading-relaxed mb-6">
              This will permanently remove the AI-generated reply from the review center. The original comment will remain untouched.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 text-xs font-bold text-[#8b949e] hover:text-white bg-[#0d1117] border border-[#30363d] px-4 py-2.5 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-rose-600/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RepliesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedVideoId = searchParams.get('videoId') || ''

  const [videos,        setVideos]        = useState([])
  const [videosLoading, setVideosLoading] = useState(true)
  const [replies,       setReplies]       = useState([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [statusFilter,  setStatusFilter]  = useState('all')

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchPublishing, setBatchPublishing] = useState(false)
  const [videoDropdownOpen, setVideoDropdownOpen] = useState(false)

  useEffect(() => { setSelectedIds(new Set()) }, [selectedVideoId, statusFilter])

  useEffect(() => {
    getVideos()
      .then(data => {
        const list = Array.isArray(data) ? data : (data.items ?? data.data ?? [])
        setVideos(list)
        if (!selectedVideoId && list.length > 0) {
          const firstId = list[0].videoId ?? list[0].id
          setSearchParams({ videoId: firstId }, { replace: true })
        }
      })
      .catch(() => {})
      .finally(() => setVideosLoading(false))
  }, [])

  const fetchReplies = useCallback(() => {
    if (!selectedVideoId) return
    setLoading(true)
    setError(null)
    listReplies({ videoId: selectedVideoId })
      .then(data => {
        const list = Array.isArray(data) ? data : (data.items ?? data.data ?? [])
        setReplies(list)
      })
      .catch(err => {
        const msg = err.response?.data?.error || err.response?.data?.message
        setError(msg || 'Failed to load replies')
      })
      .finally(() => setLoading(false))
  }, [selectedVideoId])

  useEffect(() => { fetchReplies() }, [fetchReplies])

  function handleUpdate(id, newStatus, newText) {
    setReplies(prev => prev.map(r =>
      r._id === id
        ? { ...r, status: newStatus ?? r.status, finalText: newText ?? r.finalText }
        : r
    ))
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSelectAll() {
    const available = filtered.filter(r => !['published', 'publishing'].includes(r.status))
    if (selectedIds.size === available.length && available.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(available.map(r => r._id)))
    }
  }

  async function handleBatchPublish() {
    if (selectedIds.size === 0) return;
    setBatchPublishing(true); setError(null);
    try {
      await publishBatch([...selectedIds]);
      setReplies(prev => prev.map(r => selectedIds.has(r._id) ? { ...r, status: 'publishing' } : r))
      setSelectedIds(new Set());
    } catch(err) {
      setError(err.response?.data?.error || 'Failed to batch publish')
    } finally {
      setBatchPublishing(false)
    }
  }

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return replies
    return replies.filter(r => r.status === statusFilter)
  }, [replies, statusFilter])

  const statusCounts = useMemo(() =>
    replies.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
  , [replies])

  return (
    <div className="min-h-screen text-gray-300 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Review Center</h1>
            <p className="text-[#8b949e] mt-2 font-medium">
              Manage AI-generated responses for your community.
            </p>
          </div>
          <button
            onClick={fetchReplies}
            disabled={loading || !selectedVideoId}
            className="flex items-center gap-2 text-sm font-bold bg-[#1c2128] text-white border border-[#30363d] hover:bg-[#21262d] px-5 py-2.5 rounded-xl transition-all disabled:opacity-40"
          >
            <span className={`text-lg ${loading ? 'animate-spin' : ''}`}>↻</span>
            Refresh Queue
          </button>
        </header>

        {/* Video Selection Card */}
        <div className="bg-[#0d1117] border border-[#30363d] rounded-2xl p-1 shadow-2xl">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1">
            <div className="relative flex-1" onClick={(e) => e.stopPropagation()}>
              <div
                onClick={() => !videosLoading && setVideoDropdownOpen(!videoDropdownOpen)}
                className="w-full px-5 py-4 text-sm text-white font-semibold cursor-pointer flex items-center justify-between"
              >
                <span className="truncate">
                  {videosLoading
                    ? 'Loading your videos...'
                    : videos.length === 0
                      ? 'No videos available'
                      : (videos.find(v => (v.videoId ?? v.id) === selectedVideoId)?.title || 'Select a video')
                  }
                </span>
                <span className={`text-[#484f58] text-xs transition-transform duration-200 ${videoDropdownOpen ? 'rotate-180' : ''}`}>▼</span>
              </div>

              {videoDropdownOpen && videos.length > 0 && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setVideoDropdownOpen(false)} />
                  <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl max-h-64 overflow-y-auto">
                    {videos.map(v => {
                      const vid = v.videoId ?? v.id
                      const isActive = vid === selectedVideoId
                      return (
                        <div
                          key={vid}
                          onClick={() => {
                            setSearchParams({ videoId: vid })
                            setVideoDropdownOpen(false)
                          }}
                          className={`px-5 py-3 text-sm cursor-pointer transition-colors truncate ${
                            isActive
                              ? 'text-[#ff4444] bg-[#ff4444]/5 font-bold'
                              : 'text-[#8b949e] hover:text-white hover:bg-[#1c2128]'
                          }`}
                        >
                          {v.title || 'Untitled Video'}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
            
            <div className="hidden sm:block w-px h-8 bg-[#30363d]" />

            {selectedVideoId && (
              <button
                onClick={() => navigate(`/videos/${selectedVideoId}`)}
                className="px-6 py-4 text-sm font-bold text-blue-400 hover:text-blue-300 transition-colors flex items-center justify-center gap-2"
              >
                View Comments <span>→</span>
              </button>
            )}
          </div>
        </div>

        {!selectedVideoId ? (
          <div className="flex flex-col items-center justify-center py-32 border-2 border-dashed border-[#30363d] rounded-3xl">
            <div className="w-16 h-16 bg-[#161b22] rounded-2xl flex items-center justify-center text-3xl mb-4 border border-[#30363d]">📹</div>
            <h3 className="text-white font-bold text-xl">No Video Selected</h3>
            <p className="text-[#8b949e] mt-1">Pick a video from the menu to start moderating.</p>
          </div>
        ) : (
          <>
            {/* Filter Tabs & Batch Actions */}
            {!loading && replies.length > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide flex-1">
                  {STATUS_FILTERS.map(({ key, label }) => {
                    const count = key === 'all' ? replies.length : (statusCounts[key] || 0)
                    if (key !== 'all' && count === 0) return null
                    const isActive = statusFilter === key
                    return (
                      <button
                        key={key}
                        onClick={() => setStatusFilter(key)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap border transition-all ${
                          isActive 
                          ? 'bg-[#ff4444] border-[#ff4444] text-white shadow-lg shadow-red-500/20' 
                          : 'bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#444c56]'
                        }`}
                      >
                        {label}
                        <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${isActive ? 'bg-black/20' : 'bg-[#1c2128]'}`}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center gap-2 shrink-0 border-l border-[#30363d] pl-4">
                   <button
                     onClick={handleSelectAll}
                     className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-[#30363d] text-[#8b949e] hover:text-white hover:border-white/20 bg-[#161b22]/80 transition-all"
                   >
                     {selectedIds.size > 0 ? 'Deselect All' : 'Select All'}
                   </button>
                   {selectedIds.size > 0 && (
                     <button
                       onClick={handleBatchPublish}
                       disabled={batchPublishing}
                       className="flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-blue-500 hover:bg-blue-400 text-white shadow-lg disabled:opacity-50 transition-all"
                     >
                       {batchPublishing ? 'Publishing...' : `Publish Selected (${selectedIds.size})`}
                     </button>
                   )}
                </div>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-2xl px-6 py-4 text-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg">⚠️</span>
                  <span className="font-medium">{error}</span>
                </div>
                <button onClick={fetchReplies} className="font-bold hover:underline">Retry</button>
              </div>
            )}

            {/* List Section */}
            <div className="space-y-4">
              {loading ? (
                [...Array(3)].map((_, i) => <ReplySkeleton key={i} />)
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 bg-[#0d1117] border border-[#30363d] rounded-3xl text-center px-6">
                  <span className="text-5xl mb-6">🏝️</span>
                  <h3 className="text-white font-bold text-xl">
                    {statusFilter !== 'all' ? `No ${statusFilter.replace('_', ' ')} items` : 'Queue Empty'}
                  </h3>
                  <p className="text-[#8b949e] mt-2 max-w-xs mx-auto">
                    {statusFilter !== 'all' 
                      ? "There's nothing matching this filter right now." 
                      : "Head over to the comments page to generate some AI magic."}
                  </p>
                  {statusFilter === 'all' && (
                    <button
                      onClick={() => navigate(`/videos/${selectedVideoId}`)}
                      className="mt-8 bg-[#ff4444] hover:bg-[#ee3333] text-white text-sm font-black px-8 py-3 rounded-xl transition-all shadow-xl shadow-red-500/20"
                    >
                      Go to Comments
                    </button>
                  )}
                </div>
              ) : (
                filtered.map(reply => (
                  <ReplyCard key={reply._id} reply={reply} onUpdate={handleUpdate} onDelete={(id) => setReplies(prev => prev.filter(r => r._id !== id))} selected={selectedIds.has(reply._id)} onToggleSelect={toggleSelect} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}