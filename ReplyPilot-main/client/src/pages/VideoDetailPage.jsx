import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getVideo, syncVideoComments } from '../api/channel'
import { classifyComment, listComments } from '../api/comments'
import { generateReply, createManualReply } from '../api/replies'
import { enqueueBatch } from '../api/batch'
import { listPersonas } from '../api/personas'

// ── Shared Utilities ──────────────────────────────────────────────────────
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

const INTENT_THRESHOLD = 0.2 // Only show intents above 20% confidence

const INTENT_STYLES = {
  question:      { label: 'Question',      bg: 'bg-blue-500/10',   text: 'text-blue-400',   border: 'border-blue-500/20',   dot: 'bg-blue-400'   },
  praise:        { label: 'Praise',        bg: 'bg-green-500/10',  text: 'text-green-400',  border: 'border-green-500/20',  dot: 'bg-green-400'  },
  criticism:     { label: 'Criticism',      bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20', dot: 'bg-orange-400' },
  spam:          { label: 'Spam',           bg: 'bg-red-500/10',    text: 'text-red-400',    border: 'border-red-500/20',    dot: 'bg-red-400'    },
  neutral:       { label: 'Neutral',        bg: 'bg-gray-500/10',   text: 'text-gray-400',   border: 'border-gray-500/20',   dot: 'bg-gray-400'   },
  unclassified:  { label: 'Unclassified',   bg: 'bg-yellow-500/5',  text: 'text-yellow-500', border: 'border-yellow-500/10', dot: 'bg-yellow-500' },
}

const TONES = [
  'friendly', 'professional', 'humorous', 'promotional',
  'appreciative', 'informative', 'supportive', 'apologetic', 'neutral',
  'romantic', 'rude', 'crazy',
]

// Helper: get intents above threshold from a comment
function getVisibleIntents(comment) {
  const intents = comment?.intents ?? []
  return intents.filter(i => i.confidence >= INTENT_THRESHOLD)
}

function IntentBadge({ label, confidence }) {
  const s = INTENT_STYLES[label] ?? INTENT_STYLES.unclassified
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-0.5 rounded-full border font-black uppercase tracking-widest ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1 h-1 rounded-full shrink-0 ${s.dot} animate-pulse`} />
      {s.label}
      {confidence != null && <span className="opacity-60 ml-0.5">{Math.round(confidence * 100)}%</span>}
    </span>
  )
}

function IntentBadges({ intents }) {
  const visible = (intents ?? []).filter(i => i.confidence >= INTENT_THRESHOLD)
  if (visible.length === 0) return <IntentBadge label="unclassified" />
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visible.map(i => <IntentBadge key={i.label} label={i.label} confidence={i.confidence} />)}
    </div>
  )
}

// ── Components ─────────────────────────────────────────────────────────────

function CommentCard({ comment, onClassify, onGenerate, index, selected, onToggleSelect, tone }) {
  const [classifying, setClassifying] = useState(false)
  const [generating,  setGenerating]  = useState(false)
  const [localIntents, setLocalIntents] = useState(comment.intents ?? [])
  const [replyText,   setReplyText]   = useState(null)
  const [actionError, setActionError] = useState(null)
  const [avatarError, setAvatarError] = useState(false)
  const [spamBlocked, setSpamBlocked] = useState(false)
  const [writingManual, setWritingManual] = useState(false)
  const [manualText, setManualText] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  async function handleClassify() {
    setClassifying(true); setActionError(null)
    try {
      const res = await classifyComment(comment._id)
      const newIntents = res?.data?.intents ?? res?.intents
      if (newIntents) setLocalIntents(newIntents)
      onClassify?.(comment._id, newIntents)
    } catch { setActionError('Classification Failed') }
    finally { setClassifying(false) }
  }

  async function handleGenerate(force = false) {
    setGenerating(true); setActionError(null); setReplyText(null); setSpamBlocked(false);
    
    let currentIntents = localIntents;
    if (currentIntents.length === 0 && comment.classificationStatus !== 'done') {
      try {
        const res = await classifyComment(comment._id)
        currentIntents = res?.data?.intents ?? res?.intents ?? []
        setLocalIntents(currentIntents)
        onClassify?.(comment._id, currentIntents)
      } catch {
        setActionError('Classification required to generate reply');
        setGenerating(false);
        return;
      }
    }
    
    const isSpam = currentIntents.some(i => (i.label === 'spam' && i.confidence > 0.5)) || comment.isSpam;
    if (isSpam && !force) {
       setActionError('Spam Detected. Auto-generate paused.');
       setSpamBlocked(true);
       setGenerating(false);
       return;
    }

    try {
      const res = await generateReply(comment._id, { force, tone })
      const text = res?.data?.generatedText ?? res?.data?.text ?? res?.text ?? res?.reply?.text;
      setReplyText(text || 'Reply generated.')
      onGenerate?.(comment._id)
    } catch (err) {
      setActionError(err.response?.data?.error || 'AI Generation Failed')
    } finally { setGenerating(false) }
  }

  async function handleManualSave() {
    if (!manualText.trim()) return;
    setManualSaving(true); setActionError(null);
    
    let currentIntents = localIntents;
    if (currentIntents.length === 0 && comment.classificationStatus !== 'done') {
      try {
        const res = await classifyComment(comment._id)
        currentIntents = res?.data?.intents ?? res?.intents ?? []
        setLocalIntents(currentIntents)
        onClassify?.(comment._id, currentIntents)
      } catch {
        setActionError('Classification Failed. Cannot save.');
        setManualSaving(false);
        return;
      }
    }

    try {
      await createManualReply(comment._id, { text: manualText });
      setReplyText(manualText);
      setWritingManual(false);
      onGenerate?.(comment._id);
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to save manual reply');
    } finally { setManualSaving(false); }
  }

  return (
    <div 
      style={{ animationDelay: `${index * 50}ms` }}
      className={`bg-[#161b22]/40 backdrop-blur-sm border rounded-2xl p-5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 fill-mode-both cursor-pointer ${
        selected
          ? 'border-[#ff4444]/60 bg-[#ff4444]/5 shadow-lg shadow-[#ff4444]/5'
          : 'border-[#30363d] hover:border-[#ff4444]/30'
      }`}
      onClick={() => onToggleSelect(comment._id)}
    >
      <div className="flex gap-4">
        {/* Checkbox */}
        <div className="flex items-start pt-1">
          <div
            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 shrink-0 ${
              selected
                ? 'bg-[#ff4444] border-[#ff4444] scale-110'
                : 'border-[#484f58] hover:border-[#8b949e] bg-transparent'
            }`}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(comment._id) }}
          >
            {selected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>

        {comment.authorAvatar && !avatarError ? (
          <img
            src={comment.authorAvatar}
            alt="Avatar"
            onError={() => setAvatarError(true)}
            className="w-10 h-10 rounded-xl object-cover shrink-0 border border-[#30363d] shadow-sm"
          />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ff4444] to-[#800000] flex items-center justify-center text-sm font-black text-white shrink-0">
            {comment.authorName?.[0]?.toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="flex items-center gap-2">
                <span className="text-white text-sm font-bold tracking-tight">{comment.authorName}</span>
                <span className="text-[#484f58] text-[10px] font-bold uppercase tracking-tighter">{timeAgo(comment.publishedAt)}</span>
            </div>
            <IntentBadges intents={localIntents} />
          </div>

          <p className="text-[#8b949e] text-sm leading-relaxed mb-4">{comment.textDisplay || comment.text}</p>

          {replyText && (
            <div className="mb-4 p-4 bg-[#ff4444]/5 border border-[#ff4444]/10 rounded-xl relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-[#ff4444]" />
              <p className="text-[10px] text-[#ff4444] font-black uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <span className="animate-pulse">✨</span> Reply Draft Saved
              </p>
              <p className="text-white/90 text-sm leading-relaxed italic">"{replyText}"</p>
            </div>
          )}

          {writingManual && !replyText && (
            <div className="mb-4 space-y-3">
              <textarea
                value={manualText}
                onChange={e => setManualText(e.target.value)}
                placeholder="Type your manual reply here..."
                rows={3}
                className="w-full bg-[#0d1117] border border-[#ff4444]/40 focus:border-[#ff4444] focus:ring-1 focus:ring-[#ff4444] outline-none rounded-xl px-4 py-3 text-sm text-white resize-none transition-all placeholder:text-[#484f58]"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setWritingManual(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-[#8b949e] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleManualSave}
                  disabled={manualSaving || !manualText.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-[#ff4444] hover:bg-[#ff6666] text-white transition-all disabled:opacity-50"
                >
                  {manualSaving ? 'Saving...' : 'Save Draft'}
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="mb-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-bold">
              ⚠ {actionError}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-[#30363d]/50">
            <div className="flex items-center gap-1.5 text-[#484f58] text-xs font-bold">
               {comment.likeCount > 0 && <span>👍 {fmt(comment.likeCount)}</span>}
            </div>
            
            <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleClassify() }}
                  disabled={classifying || generating || replyText}
                  className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/5 border border-[#30363d] hover:bg-white/10 text-[#8b949e] hover:text-white transition-all active:scale-95 disabled:opacity-50"
                >
                  {classifying ? 'Wait...' : 'Analyze'}
                </button>
                
                {!replyText && !writingManual && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setWritingManual(true); }}
                    className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/5 border border-[#30363d] hover:bg-white/10 text-white transition-all active:scale-95"
                  >
                    Write Reply
                  </button>
                )}

                {spamBlocked && !replyText ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGenerate(true) }}
                    disabled={generating}
                    className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-orange-500 hover:bg-orange-400 text-white shadow-lg transition-all active:scale-95 disabled:opacity-50"
                  >
                    {generating ? 'Drafting...' : 'Force Generate'}
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGenerate(false) }}
                    disabled={generating || classifying || replyText}
                    className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#ff4444] hover:bg-[#ff6666] text-white shadow-lg shadow-[#ff4444]/10 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {generating ? 'Drafting...' : 'Generate Reply'}
                  </button>
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function VideoInfoBar({ video }) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-3xl p-6 flex flex-col md:flex-row gap-6 items-center shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-[#ff4444]/5 blur-3xl pointer-events-none" />
      
      <img
        src={video.thumbnail?.high || video.thumbnails?.high?.url}
        alt="Thumb"
        className="w-full md:w-64 aspect-video object-cover rounded-2xl border border-[#30363d]"
      />
      
      <div className="flex-1 text-center md:text-left">
        <h2 className="text-white font-black text-xl leading-tight tracking-tight mb-2">{video.title}</h2>
        <div className="flex items-center justify-center md:justify-start gap-4 text-[10px] font-black uppercase tracking-[0.15em] text-[#8b949e]">
          <span className="flex items-center gap-1.5"><span className="text-[#ff4444]">👁</span> {fmt(video.viewCount)}</span>
          <span className="flex items-center gap-1.5"><span className="text-[#ff4444]">💬</span> {fmt(video.commentCount)}</span>
          <span className="flex items-center gap-1.5"><span className="text-[#ff4444]">👍</span> {fmt(video.likeCount)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Batch Action Bar ───────────────────────────────────────────────────────

function CustomSelect({ value, onChange, options, placeholder="Select..." }) {
  const [open, setOpen] = useState(false);
  
  useEffect(() => {
    const handleWindowClick = () => setOpen(false);
    if(open) window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, [open]);

  const selectedOption = options.find(o => o.value === value);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <div 
        onClick={() => setOpen(!open)}
        className="bg-[#161b22] border border-[#30363d] hover:border-[#ff4444]/30 rounded-xl px-3 py-2 text-white text-xs font-bold transition-colors cursor-pointer select-none flex items-center justify-between min-w-[120px]"
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <span className="ml-3 text-[#8b949e] text-[8px] transform transition-transform duration-200" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
      </div>
      
      {open && (
        <div className="absolute top-full right-0 mt-2 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto w-max min-w-full custom-scrollbar animate-in fade-in zoom-in-95 duration-200">
          {options.map(opt => (
            <div 
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`px-4 py-2.5 text-xs font-bold cursor-pointer hover:bg-[#ff4444]/10 transition-colors ${value === opt.value ? 'text-[#ff4444] bg-[#ff4444]/5' : 'text-[#8b949e]'}`}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BatchBar({ selectedCount, totalCount, tone, onToneChange, personaId, onPersonaChange, personas, onBatchGenerate, loading }) {
  return (
    <div className="sticky top-0 z-20 bg-[#0d1117]/95 backdrop-blur-xl border border-[#ff4444]/20 rounded-2xl p-4 shadow-2xl shadow-[#ff4444]/5 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: Selection info */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#ff4444]/10 flex items-center justify-center">
            <span className="text-[#ff4444] text-sm font-black">{selectedCount}</span>
          </div>
          <div>
            <p className="text-white text-sm font-bold leading-tight">
              {selectedCount === totalCount ? 'All' : selectedCount} comment{selectedCount !== 1 ? 's' : ''} selected
            </p>
            <p className="text-[#484f58] text-[10px] font-bold uppercase tracking-widest">
              Will classify & auto-generate replies
            </p>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tone Picker */}
          <div className="flex items-center gap-2">
            <label className="text-[#484f58] text-[10px] font-black uppercase tracking-widest leading-none mt-0.5">Tone</label>
            <CustomSelect 
              value={tone}
              onChange={onToneChange}
              options={TONES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
            />
          </div>

          {/* Persona Picker */}
          {personas.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[#484f58] text-[10px] font-black uppercase tracking-widest leading-none mt-0.5">Persona</label>
              <CustomSelect 
                value={personaId}
                onChange={onPersonaChange}
                options={[{value: '', label: 'None'}].concat(personas.map(p => ({ value: p._id, label: p.name })))}
              />
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={onBatchGenerate}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#ff4444] hover:bg-[#ff6666] text-white shadow-lg shadow-[#ff4444]/20 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin">⏳</span> Queuing...
              </>
            ) : (
              <>
                🚀 Generate Replies ({selectedCount})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toast Banner ───────────────────────────────────────────────────────────

function Toast({ message, type, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  const colors = type === 'success'
    ? 'bg-green-500/10 border-green-500/30 text-green-400'
    : 'bg-red-500/10 border-red-500/30 text-red-400'

  return (
    <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl border ${colors} text-sm font-bold shadow-2xl animate-in fade-in slide-in-from-right-4 duration-300 max-w-sm`}>
      <div className="flex items-center gap-3">
        <span>{type === 'success' ? '✅' : '❌'}</span>
        <span>{message}</span>
        <button onClick={onDismiss} className="ml-2 opacity-50 hover:opacity-100 transition-opacity">✕</button>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function VideoDetailPage() {
  const { videoId } = useParams(); const navigate = useNavigate()
  const [video, setVideo] = useState(null); const [videoLoading, setVideoLoading] = useState(true)
  const [comments, setComments] = useState([]); const [commentsLoading, setCommentsLoading] = useState(true)
  const [intentFilter, setIntentFilter] = useState('all'); const [syncing, setSyncing] = useState(false)
  const [forceSyncing, setForceSyncing] = useState(false)

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchTone, setBatchTone] = useState('friendly')
  const [batchPersonaId, setBatchPersonaId] = useState('')
  const [personas, setPersonas] = useState([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    getVideo(videoId).then(setVideo).finally(() => setVideoLoading(false))
  }, [videoId])

  // Load personas for the persona picker
  useEffect(() => {
    listPersonas()
      .then(res => {
        const items = Array.isArray(res) ? res : (res?.data ?? res?.items ?? [])
        setPersonas(items)
        const defaultPersona = items.find(p => p.isDefault)
        if (defaultPersona) {
          setBatchPersonaId(defaultPersona._id)
        }
      })
      .catch(() => setPersonas([]))
  }, [])

  const fetchComments = useCallback(() => {
    setCommentsLoading(true)
    listComments({ videoId, limit: 100, sortBy: 'publishedAt', order: 'desc' })
      .then(data => {
        const items = (Array.isArray(data) ? data : (data.items ?? data.data ?? [])).filter(c => !c.isReply)
        setComments(items)
        setSelectedIds(new Set()) // reset selection on refresh
      })
      .finally(() => { setCommentsLoading(false); setSyncing(false) })
  }, [videoId])

  useEffect(() => { fetchComments() }, [fetchComments])

  async function handleForceSync() {
    setForceSyncing(true)
    try {
      const result = await syncVideoComments(videoId)
      setToast({
        type: 'success',
        message: result?.message || `Synced ${result?.totalSynced ?? 0} comments from YouTube`,
      })
      fetchComments() // reload from MongoDB
    } catch (err) {
      setToast({
        type: 'error',
        message: err?.message || 'Failed to sync comments from YouTube',
      })
    } finally {
      setForceSyncing(false)
    }
  }

  const filtered = intentFilter === 'all'
    ? comments
    : intentFilter === 'unclassified'
      ? comments.filter(c => !c.intents || c.intents.length === 0)
      : comments.filter(c => (c.intents ?? []).some(i => i.label === intentFilter && i.confidence >= INTENT_THRESHOLD))

  const intentCounts = comments.reduce((acc, c) => {
    const visible = getVisibleIntents(c)
    if (visible.length === 0) {
      acc['unclassified'] = (acc['unclassified'] || 0) + 1
    } else {
      for (const i of visible) {
        acc[i.label] = (acc[i.label] || 0) + 1
      }
    }
    return acc
  }, {})

  // ── Selection handlers ──────────────────────────────────────────────────

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(c => c._id)))
    }
  }

  async function handleBatchGenerate() {
    if (selectedIds.size === 0) return
    setBatchLoading(true)
    try {
      const result = await enqueueBatch({
        videoId,
        commentIds: [...selectedIds],
        tone: batchTone,
        personaId: batchPersonaId || undefined,
      })
      setToast({
        type: 'success',
        message: result?.message || `${result?.queued ?? selectedIds.size} comments queued for processing`,
      })
      setSelectedIds(new Set())
    } catch (err) {
      setToast({
        type: 'error',
        message: err?.response?.data?.message || err?.data?.message || err?.message || 'Failed to enqueue batch',
      })
    } finally {
      setBatchLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto pb-20">
      
      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      <button onClick={() => navigate('/videos')} className="group flex items-center gap-2 text-[#8b949e] hover:text-[#ff4444] text-xs font-black uppercase tracking-widest transition-all">
        <span className="group-hover:-translate-x-1 transition-transform">←</span> Return to Library
      </button>

      {videoLoading ? <div className="h-40 bg-[#161b22] rounded-3xl animate-pulse" /> : video && <VideoInfoBar video={video} />}

      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-[#30363d]/50 pb-4">
          <h1 className="text-2xl font-black text-white tracking-tight uppercase">
            Audience <span className="text-[#ff4444]">Feedback</span>
            <span className="ml-3 text-xs text-[#484f58] font-bold">[{filtered.length} visible]</span>
          </h1>
          <div className="flex items-center gap-3">
            <button onClick={fetchComments} disabled={syncing} className="text-[10px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white flex items-center gap-2">
              <span className={syncing ? 'animate-spin' : ''}>↻</span> {syncing ? 'Loading' : 'Refresh'}
            </button>
            <div className="w-px h-5 bg-[#30363d]" />
            <button
              onClick={handleForceSync}
              disabled={forceSyncing}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center gap-2 ${
                forceSyncing
                  ? 'bg-white/5 text-white border border-[#30363d]'
                  : 'bg-[#ff4444] hover:bg-[#ff6666] text-white shadow-lg shadow-[#ff4444]/20'
              }`}
            >
              <span className={forceSyncing ? 'animate-spin' : ''}>⟳</span>
              {forceSyncing ? 'Syncing...' : 'Force Sync'}
            </button>
          </div>
        </div>

        {/* Intent filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {['all', 'unclassified', 'question', 'praise', 'criticism', 'spam', 'neutral'].map(key => {
            const count = key === 'all' ? comments.length : (intentCounts[key] || 0)
            if (key !== 'all' && count === 0) return null
            return (
              <button key={key} onClick={() => { setIntentFilter(key); setSelectedIds(new Set()) }} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${intentFilter === key ? 'bg-[#ff4444] border-[#ff4444] text-white shadow-lg shadow-[#ff4444]/20' : 'bg-[#161b22]/80 border-[#30363d] text-[#8b949e] hover:border-white/20 hover:text-white'}`}>
                {key} <span className="ml-1 opacity-50">{count}</span>
              </button>
            )
          })}

          {/* Divider + Select controls */}
          <div className="w-px h-6 bg-[#30363d] mx-1" />
          <button
            onClick={toggleSelectAll}
            className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-[#30363d] text-[#8b949e] hover:text-white hover:border-white/20 bg-[#161b22]/80 transition-all"
          >
            {selectedIds.size === filtered.length && filtered.length > 0 ? '✕ Deselect All' : '☐ Select All'}
          </button>
        </div>

        {/* Batch action bar — appears when comments are selected */}
        {selectedIds.size > 0 && (
          <BatchBar
            selectedCount={selectedIds.size}
            totalCount={filtered.length}
            tone={batchTone}
            onToneChange={setBatchTone}
            personaId={batchPersonaId}
            onPersonaChange={setBatchPersonaId}
            personas={personas}
            onBatchGenerate={handleBatchGenerate}
            loading={batchLoading}
          />
        )}

        {/* Comments list */}
        <div className="flex flex-col gap-4">
          {commentsLoading ? [...Array(3)].map((_, i) => <div key={i} className="h-32 bg-[#161b22]/50 rounded-2xl animate-pulse" />) :
            filtered.length === 0 ? (
              <div className="text-center py-20 bg-[#161b22]/20 rounded-3xl border border-dashed border-[#30363d]">
                <p className="text-[#484f58] font-black uppercase tracking-[0.2em]">No Comments in this Category</p>
              </div>
            ) : filtered.map((c, idx) => (
              <CommentCard
                key={c._id}
                index={idx}
                comment={c}
                selected={selectedIds.has(c._id)}
                onToggleSelect={toggleSelect}
                tone={batchTone}
                onClassify={(id, intents) => setComments(prev => prev.map(item => item._id === id ? { ...item, intents } : item))}
              />
            ))
          }
        </div>
      </div>
    </div>
  )
}