import { useCallback, useEffect, useRef, useState } from 'react'
import { GestureRecognizer, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision'

const STORAGE_KEY = 'echotrail.signVocabulary.v1'
const CUSTOM_MATCH_THRESHOLD = 0.4 // for your own taught poses
const BUILTIN_CONFIDENCE_THRESHOLD = 0.75 // for the pretrained gestures below

// The pretrained model recognizes these 7 gestures for ANY hand, any user,
// zero training required. "None" means no confident match was found.
const BUILTIN_GESTURE_LABELS = {
  Thumb_Up: 'thumbs up',
  Thumb_Down: 'thumbs down',
  Open_Palm: 'open palm',
  Closed_Fist: 'fist',
  Victory: 'peace',
  Pointing_Up: 'pointing up',
  ILoveYou: 'i love you',
}

function landmarksToVector(landmarks) {
  const wrist = landmarks[0]
  const scaled = landmarks.map((p) => ({
    x: p.x - wrist.x,
    y: p.y - wrist.y,
    z: p.z - wrist.z,
  }))
  const scale =
    Math.hypot(scaled[9].x, scaled[9].y, scaled[9].z) || 1
  return scaled.flatMap((p) => [p.x / scale, p.y / scale, p.z / scale])
}

function cosineDistance(a, b) {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  return 1 - dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1)
}

function loadVocabulary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveVocabulary(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function useSignChannel({ onSignDetected } = {}) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const recognizerRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const latestVectorRef = useRef(null)
  const lastEmittedRef = useRef({ label: null, at: 0 })
  const frameTimesRef = useRef([])

  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [handVisible, setHandVisible] = useState(false)
  const [vocabulary, setVocabulary] = useState(loadVocabulary)
  const [activeMatch, setActiveMatch] = useState(null) // { label, confidence, source: 'builtin' | 'custom' } | null
  const [fps, setFps] = useState(0)
  const [justDetected, setJustDetected] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [error, setError] = useState(null)

  // Load the pretrained gesture model once, lazily, the first time start() is called.
  const ensureRecognizer = useCallback(async () => {
    if (recognizerRef.current) return recognizerRef.current
    setLoading(true)
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
    )
    const recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    })
    recognizerRef.current = recognizer
    setLoading(false)
    setModelReady(true)
    return recognizer
  }, [])

  function registerDetection(label, confidence, source) {
    setActiveMatch({ label, confidence, source })

    const now = Date.now()
    const isRepeat =
      lastEmittedRef.current.label === label &&
      now - lastEmittedRef.current.at < 4000
    if (isRepeat) return

    lastEmittedRef.current = { label, at: now }
    onSignDetected?.(label, confidence)
    setJustDetected(true)
    setTimeout(() => setJustDetected(false), 500)
  }

  function matchCustomVocabulary(vector) {
    if (vocabulary.length === 0) return null
    let best = null
    for (const entry of vocabulary) {
      const distance = cosineDistance(vector, entry.vector)
      if (!best || distance < best.distance) best = { ...entry, distance }
    }
    if (!best || best.distance > CUSTOM_MATCH_THRESHOLD) return null
    const confidence = Math.round((1 - best.distance / CUSTOM_MATCH_THRESHOLD) * 100)
    return { label: best.label, confidence }
  }

  const runLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const recognizer = recognizerRef.current
    if (!video || !canvas || !recognizer || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runLoop)
      return
    }

    // rolling FPS counter
    const now = performance.now()
    const times = frameTimesRef.current
    times.push(now)
    if (times.length > 20) times.shift()
    if (times.length > 1) {
      const avgGap = (times[times.length - 1] - times[0]) / (times.length - 1)
      setFps(avgGap > 0 ? Math.round(1000 / avgGap) : 0)
    }

    const results = recognizer.recognizeForVideo(video, now)
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const landmarks = results.landmarks?.[0]
    setHandVisible(Boolean(landmarks))

    if (landmarks) {
      const drawingUtils = new DrawingUtils(ctx)
      drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, {
        color: '#4fb8ac',
        lineWidth: 2,
      })
      drawingUtils.drawLandmarks(landmarks, { color: '#e8a355', radius: 2 })

      const vector = landmarksToVector(landmarks)
      latestVectorRef.current = vector

      // 1. Prefer your own taught custom poses first — you taught them
      // deliberately, so they should win over a loosely similar built-in.
      const customMatch = matchCustomVocabulary(vector)
      if (customMatch) {
        registerDetection(customMatch.label, customMatch.confidence, 'custom')
      } else {
        // 2. Otherwise fall back to the pretrained built-in gesture, if confident.
        const topGesture = results.gestures?.[0]?.[0]
        if (
          topGesture &&
          topGesture.categoryName !== 'None' &&
          topGesture.score >= BUILTIN_CONFIDENCE_THRESHOLD
        ) {
          const label = BUILTIN_GESTURE_LABELS[topGesture.categoryName] || topGesture.categoryName
          registerDetection(label, Math.round(topGesture.score * 100), 'builtin')
        } else {
          setActiveMatch(null)
        }
      }
    } else {
      latestVectorRef.current = null
      setActiveMatch(null)
    }

    ctx.restore()
    rafRef.current = requestAnimationFrame(runLoop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabulary])

  const startingRef = useRef(false)

  const [cameras, setCameras] = useState([])

  const refreshCameraList = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameras(devices.filter((d) => d.kind === 'videoinput'))
    } catch {
      // enumeration can fail before permission is granted — non-critical
    }
  }, [])

  const start = useCallback(async (deviceId) => {
    if (!videoRef.current || startingRef.current || running) return
    startingRef.current = true
    setError(null)
    try {
      await ensureRecognizer()

      let stream
      const videoConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints })
      } catch {
        // The higher-res/specific-device request can fail on some webcams —
        // fall back to whatever default camera the browser picks.
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
      }
      await refreshCameraList() // labels only become available after permission is granted

      streamRef.current = stream
      videoRef.current.srcObject = stream
      try {
        await videoRef.current.play()
      } catch (err) {
        // Harmless if a second start() interrupted the first play() call —
        // the stream is already attached and will play once settled.
        if (err.name !== 'AbortError') throw err
      }
      setRunning(true)
      rafRef.current = requestAnimationFrame(runLoop)
    } catch (err) {
      console.error('Camera failed to start:', err)
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera permission was denied — check your browser/site settings.'
          : err.name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'Could not start the camera. Try again, or check if another app is using it.',
      )
    } finally {
      startingRef.current = false
    }
  }, [ensureRecognizer, runLoop, running, refreshCameraList])

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    setRunning(false)
    setHandVisible(false)
    setActiveMatch(null)
  }, [])

  useEffect(() => stop, [stop]) // cleanup on unmount

  /** Capture the hand pose on screen right now and save it under `label`. */
  const teachSign = useCallback(
    (label) => {
      if (!latestVectorRef.current || !label.trim()) return false
      const entries = [
        ...vocabulary,
        { label: label.trim(), vector: latestVectorRef.current },
      ]
      setVocabulary(entries)
      saveVocabulary(entries)
      return true
    },
    [vocabulary],
  )

  const clearVocabulary = useCallback(() => {
    setVocabulary([])
    saveVocabulary([])
  }, [])

  const removeSign = useCallback(
    (label) => {
      const entries = vocabulary.filter((e) => e.label !== label)
      setVocabulary(entries)
      saveVocabulary(entries)
    },
    [vocabulary],
  )

  const knownLabels = [...new Set(vocabulary.map((e) => e.label))]

  return {
    videoRef,
    canvasRef,
    running,
    loading,
    modelReady,
    error,
    cameras,
    handVisible,
    activeMatch,
    fps,
    justDetected,
    start,
    stop,
    teachSign,
    clearVocabulary,
    removeSign,
    knownLabels,
    builtinGestures: Object.values(BUILTIN_GESTURE_LABELS),
  }
}
