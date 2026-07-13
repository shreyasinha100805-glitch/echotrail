import { useCallback, useEffect, useRef, useState } from 'react'
import { useVoiceChannel } from './hooks/useVoiceChannel'
import { useSignChannel } from './hooks/useSignChannel'

// Small inline icons — kept dependency-free rather than pulling in a full icon library.
const MicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
    <path d="M12 18v4M8 22h8" />
  </svg>
)
const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" />
  </svg>
)
const HandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 8 8h1a8 8 0 0 0 8-8v-3a2 2 0 0 0-4 0v1" />
  </svg>
)
const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </svg>
)
const ClockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
)
const ListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

export default function App() {
  const [transcript, setTranscript] = useState([])
  const [teachLabel, setTeachLabel] = useState('')
  const [sessionStart] = useState(() => Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)
  const [fontScale, setFontScale] = useState(1) // real accessibility control, not decorative
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('echotrail.sessionHistory') || '[]')
    } catch {
      return []
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lang, setLang] = useState('en-US')
  const [muted, setMuted] = useState(false)
  const [selectedCamera, setSelectedCamera] = useState('')
  const fpsSamplesRef = useRef([])
  const logEndRef = useRef(null)

  function resetSession() {
    setTranscript([])
    fpsSamplesRef.current = []
  }

  useEffect(() => {
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - sessionStart) / 1000)), 1000)
    return () => clearInterval(id)
  }, [sessionStart])

  const appendLine = useCallback((source, text, confidence) => {
    setTranscript((prev) => [
      ...prev.slice(-49),
      { source, text, confidence, time: new Date(), id: Date.now() + Math.random() },
    ])
    queueMicrotask(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }, [])

  const voice = useVoiceChannel({
    onFinalTranscript: (text) => appendLine('voice', text),
    lang,
  })

  const sign = useSignChannel({
    onSignDetected: (label, confidence) => {
      appendLine('sign', label, confidence)
      if (!muted) voice.speak(label) // speak the recognized sign out loud, unless muted
    },
  })

  const systemReady = voice.supported
  useEffect(() => {
    if (sign.running && sign.fps > 0) {
      fpsSamplesRef.current.push(sign.fps)
      if (fpsSamplesRef.current.length > 200) fpsSamplesRef.current.shift()
    }
  }, [sign.fps, sign.running])

  const avgFps = fpsSamplesRef.current.length
    ? Math.round(fpsSamplesRef.current.reduce((a, b) => a + b, 0) / fpsSamplesRef.current.length)
    : 0

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * fontScale}px`
  }, [fontScale])

  const anyChannelActive = voice.listening || sign.running

  const wordCount = transcript
    .filter((l) => l.source === 'voice')
    .reduce((sum, l) => sum + l.text.trim().split(/\s+/).filter(Boolean).length, 0)
  const signCount = transcript.filter((l) => l.source === 'sign').length

  function formatDuration(totalSeconds) {
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function transcriptAsText() {
    return transcript
      .map((l) => `[${l.source === 'voice' ? 'Spoken' : 'Signed'}] ${l.text}`)
      .join('\n')
  }

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcriptAsText())
    } catch {
      // clipboard permission denied or unavailable — non-critical, user can still export
    }
  }

  function downloadTranscript() {
    const blob = new Blob([transcriptAsText()], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `echotrail-transcript-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadTranscriptJSON() {
    const payload = {
      exportedAt: new Date().toISOString(),
      durationSeconds: elapsedSec,
      wordCount,
      signCount,
      lines: transcript.map(({ source, text }) => ({ source, text })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `echotrail-transcript-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function saveSession() {
    if (transcript.length === 0) return
    const entry = {
      id: Date.now(),
      date: new Date().toLocaleString(),
      durationSeconds: elapsedSec,
      wordCount,
      signCount,
    }
    const updated = [entry, ...history].slice(0, 10) // keep last 10, real data only
    setHistory(updated)
    localStorage.setItem('echotrail.sessionHistory', JSON.stringify(updated))
  }

  function clearHistory() {
    setHistory([])
    localStorage.removeItem('echotrail.sessionHistory')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">echo<span className="dot">·</span>trail</span>
        </div>

        <nav className="sidebar__nav">
          <a href="#top" className="sidebar__nav-item sidebar__nav-item--active">
            <HomeIcon /> Session
          </a>
          <a href="#history" className="sidebar__nav-item">
            <ClockIcon /> History
          </a>
          <a href="#transcript" className="sidebar__nav-item">
            <ListIcon /> Transcript
          </a>
        </nav>

        <div className="sidebar__controls">
          <div className="font-size-toggle" role="group" aria-label="Text size">
            <button
              className={fontScale === 0.9 ? 'active' : ''}
              onClick={() => setFontScale(0.9)}
              aria-label="Small text"
            >
              A
            </button>
            <button
              className={fontScale === 1 ? 'active' : ''}
              onClick={() => setFontScale(1)}
              aria-label="Default text size"
            >
              A
            </button>
            <button
              className={fontScale === 1.2 ? 'active' : ''}
              onClick={() => setFontScale(1.2)}
              aria-label="Large text"
            >
              A
            </button>
          </div>
          <button className="sidebar__util-btn" onClick={resetSession}>⟲ Reset session</button>
          <button className="sidebar__util-btn" onClick={() => setSettingsOpen((v) => !v)}>⚙ Settings</button>
        </div>

        {/* "Now playing"-style live status card, Spotify-bottom-bar inspired */}
        <div className={`sidebar__now-playing ${sign.activeMatch ? 'sidebar__now-playing--active' : ''}`}>
          <span className="sidebar__now-playing-label">Now recognizing</span>
          <span className="sidebar__now-playing-value">
            {sign.activeMatch ? sign.activeMatch.label : '—'}
          </span>
        </div>
      </aside>

      <main className="app-main" id="top">
      <header className="app__header">
        <div>
          <p className="app__subtitle">
            live bridge between spoken and signed conversation
          </p>
        </div>
        <div className="app__header-right">
          <span className={`status-pill ${anyChannelActive ? 'on' : ''}`}>
            <span className="dot" /> {anyChannelActive ? 'Session active' : 'Standing by'}
          </span>
          <p className="app__subtitle">
            {sign.knownLabels.length} sign{sign.knownLabels.length === 1 ? '' : 's'} taught
          </p>
        </div>
      </header>

      {settingsOpen && (
        <div className="settings-panel">
          <div className="settings-row">
            <label htmlFor="lang-select">🌍 Speech language</label>
            <select
              id="lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              disabled={voice.listening}
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="hi-IN">Hindi</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
              <option value="ja-JP">Japanese</option>
            </select>
            {voice.listening && <span className="status-note">stop listening to change</span>}
          </div>

          <div className="settings-row">
            <label htmlFor="camera-select">📷 Camera</label>
            <select
              id="camera-select"
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              disabled={sign.running}
            >
              <option value="">Default camera</option>
              {(sign.cameras || []).map((cam, i) => (
                <option key={cam.deviceId} value={cam.deviceId}>
                  {cam.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
            {(sign.cameras || []).length === 0 && (
              <span className="status-note">start camera once to list devices</span>
            )}
          </div>

          <div className="settings-row">
            <label htmlFor="mute-toggle">🔊 Speak recognized signs aloud</label>
            <button
              id="mute-toggle"
              className={muted ? '' : 'active-toggle'}
              onClick={() => setMuted((v) => !v)}
            >
              {muted ? 'Muted' : 'On'}
            </button>
          </div>
        </div>
      )}

      <div className="channels">
        {/* VOICE CHANNEL — speech in, captions out */}
        <div className="channel channel--voice">
          <div className="channel__label">
            <span className="swatch" /> spoken
          </div>

          <div className="status-row">
            <span className={`status-pill ${voice.listening ? 'on' : ''}`}>
              <span className="dot" /> {voice.listening ? 'Listening' : 'Idle'}
            </span>
          </div>

          <div className="mic-orb">
            {!voice.listening && (
              <div className="mic-orb__placeholder">
                <MicIcon />
                <span>Click "Start listening" to begin</span>
                <ul className="mic-orb__tips">
                  <li>Speak clearly at a normal pace</li>
                  <li>Minimize background noise</li>
                  <li>Works best in Chrome or Edge</li>
                </ul>
              </div>
            )}
            {Array.from({ length: 9 }).map((_, i) => {
              // middle bars react more than the edges, for a natural waveform shape
              const weight = 1 - Math.abs(i - 4) / 4.5
              const baseHeight = 6
              const activeHeight = voice.listening
                ? baseHeight + voice.audioLevel * 60 * weight + Math.random() * 4 * weight
                : baseHeight
              return (
                <div
                  key={i}
                  className="mic-orb__bar"
                  style={{ height: `${Math.max(baseHeight, activeHeight)}px` }}
                />
              )
            })}
          </div>

          <div className="controls">
            {!voice.listening ? (
              <button
                className="primary--voice"
                onClick={voice.start}
                disabled={!voice.supported}
              >
                <MicIcon /> Start listening
              </button>
            ) : (
              <button onClick={voice.stop}>
                <MicIcon /> Stop listening
              </button>
            )}
          </div>

          {!voice.supported && (
            <p className="status-note">
              Speech recognition isn't supported in this browser — try Chrome or Edge.
            </p>
          )}
          {voice.interimText && (
            <p className="status-note">hearing: "{voice.interimText}"</p>
          )}
        </div>

        {/* SIGN CHANNEL — camera in, gloss out */}
        <div className="channel channel--sign">
          <div className="channel__label">
            <span className="swatch" /> signed
          </div>

          <div className="status-row">
            <span className={`status-pill ${sign.modelReady ? 'on' : ''}`}>
              <span className="dot" /> {sign.loading ? 'Processing…' : sign.modelReady ? 'AI Ready' : 'AI not loaded'}
            </span>
            <span className={`status-pill ${sign.running ? 'on' : ''}`}>
              <span className="dot" /> {sign.running ? 'Camera active' : 'Camera off'}
            </span>
            <span className={`status-pill ${sign.handVisible ? 'on' : ''}`}>
              <span className="dot" /> {sign.handVisible ? 'Gesture detected' : 'No hand'}
            </span>
            {sign.running && <span className="status-pill">{sign.fps} FPS</span>}
          </div>

          <div className={`video-frame ${sign.justDetected ? 'video-frame--pulse' : ''}`}>
            {!sign.running && !sign.loading && (
              <div className="video-frame__placeholder">
                <CameraIcon />
                <span>Click "Start camera" to begin</span>
              </div>
            )}
            {sign.loading && (
              <div className="video-frame__placeholder">
                <div className="spinner" />
                <span>Loading gesture model…</span>
              </div>
            )}
            <video ref={sign.videoRef} autoPlay playsInline muted />
            <canvas ref={sign.canvasRef} width={480} height={360} />
          </div>

          <div className={`current-sign-card ${sign.activeMatch ? 'current-sign-card--active' : ''}`}>
            {sign.activeMatch ? (
              <>
                <span className="current-sign-card__label">Current Sign</span>
                <span className="current-sign-card__value">{sign.activeMatch.label}</span>
                <span className="current-sign-card__confidence">
                  {sign.activeMatch.confidence}% confidence · {sign.activeMatch.source}
                </span>
              </>
            ) : (
              <span className="current-sign-card__label">No sign currently detected</span>
            )}
          </div>

          <div className="controls">
            {!sign.running ? (
              <button className="primary--sign" onClick={() => sign.start(selectedCamera)} disabled={sign.loading}>
                <CameraIcon /> {sign.loading ? 'Loading model…' : 'Start camera'}
              </button>
            ) : (
              <button onClick={sign.stop}>
                <CameraIcon /> Stop camera
              </button>
            )}
          </div>

          <p className="status-note">
            {sign.running
              ? sign.handVisible
                ? 'hold a pose steady to match it'
                : 'show a hand to the camera'
              : 'camera is off'}
          </p>

          {sign.error && <p className="status-note status-note--error">{sign.error}</p>}

          <p className="status-note">
            Built in, no teaching needed: {sign.builtinGestures.join(' · ')}
          </p>

          {/* Teach-a-sign flow: hold a pose, name it, and it's added to the
              vocabulary immediately — this is how you build up the demo's
              recognized sign set during the hackathon itself. */}
          <div className="controls">
            <input
              type="text"
              placeholder="name this pose (e.g. hello)"
              value={teachLabel}
              onChange={(e) => setTeachLabel(e.target.value)}
              className="teach-input"
            />
            <button
              onClick={() => {
                const ok = sign.teachSign(teachLabel)
                if (ok) setTeachLabel('')
              }}
              disabled={!sign.handVisible || !teachLabel.trim()}
            >
              <HandIcon /> Teach this pose
            </button>
          </div>

          {sign.knownLabels.length > 0 && (
            <>
              <div className="gloss-tray">
                {sign.knownLabels.map((label) => (
                  <button
                    className="gloss-chip"
                    key={label}
                    onClick={() => sign.removeSign(label)}
                    title="Click to remove — hold the pose again and re-teach it"
                  >
                    {label} <span className="gloss-chip__x">×</span>
                  </button>
                ))}
              </div>
              <button className="clear-all-btn" onClick={sign.clearVocabulary}>
                Clear all taught poses
              </button>
            </>
          )}
        </div>
      </div>

      <div className="stats-bar">
        <div className="stat">
          <span className="stat__value">{elapsedSec > 0 ? formatDuration(elapsedSec) : '0:00'}</span>
          <span className="stat__label">Session time</span>
        </div>
        <div className="stat">
          <span className="stat__value">{wordCount}</span>
          <span className="stat__label">Words captured</span>
        </div>
        <div className="stat">
          <span className="stat__value">{signCount}</span>
          <span className="stat__label">Signs recognized</span>
        </div>
        <div className="stat">
          <span className="stat__value">{avgFps || '—'}</span>
          <span className="stat__label">Average FPS</span>
        </div>
      </div>

      {history.length > 0 && (
        <div className="history-panel" id="history">
          <div className="history-panel__header">
            <span className="transcript__label">recent sessions</span>
            <button className="transcript__clear" onClick={clearHistory}>Clear history</button>
          </div>
          <div className="history-list">
            {history.map((h) => (
              <div className="history-item" key={h.id}>
                <span className="history-item__date">{h.date}</span>
                <span className="history-item__stats">
                  {h.wordCount} words · {h.signCount} signs · {formatDuration(h.durationSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="transcript" id="transcript">
        <div className="transcript__header">
          <div className="transcript__label">shared transcript</div>
          <div className="transcript__actions">
            {transcript.length > 0 && (
              <>
                <button className="transcript__clear" onClick={copyTranscript}>
                  Copy
                </button>
                <button className="transcript__clear" onClick={downloadTranscript}>
                  Export .txt
                </button>
                <button className="transcript__clear" onClick={downloadTranscriptJSON}>
                  Export .json
                </button>
                <button className="transcript__clear" onClick={saveSession}>
                  Save session
                </button>
                <button className="transcript__clear" onClick={() => setTranscript([])}>
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
        <div className="transcript__log">
          {transcript.length === 0 && (
            <div className="transcript__empty-state">
              <p className="transcript__empty-title">Ready to bridge a conversation</p>
              <ul>
                <li>✓ Capture speech live, as text</li>
                <li>✓ Recognize hand gestures, spoken aloud</li>
                <li>✓ Log both sides in one shared transcript</li>
              </ul>
            </div>
          )}
          {transcript.map((line) => (
            <div
              key={line.id}
              className={`bubble-row bubble-row--${line.source}`}
            >
              <span className={`bubble-icon bubble-icon--${line.source}`}>
                {line.source === 'voice' ? <MicIcon /> : <HandIcon />}
              </span>
              <div className={`bubble bubble--${line.source}`}>
                <div className="bubble__meta">
                  {line.time?.toLocaleTimeString([], { hour12: false })}
                  {line.confidence != null && ` · ${line.confidence}%`}
                </div>
                <div className="bubble__text">{line.text}</div>
              </div>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
      </main>
    </div>
  )
}
