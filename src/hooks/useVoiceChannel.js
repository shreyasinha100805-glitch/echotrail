import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Wraps the browser's Web Speech API for two jobs:
 *  - continuous speech -> live caption text (for the deaf/HoH side)
 *  - text -> spoken audio (used to voice recognized signs back out loud)
 *
 * Both directions are free and run entirely client-side. Coverage varies
 * by browser — Chrome/Edge on desktop are the most reliable during a demo.
 */
export function useVoiceChannel({ onFinalTranscript, lang = 'en-US' } = {}) {
  const [listening, setListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [supported, setSupported] = useState(true)
  const [audioLevel, setAudioLevel] = useState(0) // 0-1, drives the mic pulse/waveform
  const recognitionRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSupported(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          onFinalTranscript?.(text.trim())
        } else {
          interim += text
        }
      }
      setInterimText(interim)
    }

    recognition.onend = () => {
      // auto-restart while the user has listening toggled on, so a brief
      // silence doesn't end the session mid-conversation
      if (recognitionRef.current?.__shouldRun) {
        recognition.start()
      } else {
        setListening(false)
      }
    }

    recognitionRef.current = recognition
    return () => recognition.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const startAudioMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      audioCtx.createMediaStreamSource(stream).connect(analyser)
      audioCtxRef.current = audioCtx
      analyserRef.current = analyser

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length
        setAudioLevel(Math.min(1, avg / 100)) // normalize roughly to 0-1
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // mic meter is cosmetic — if it fails, speech recognition still works fine
    }
  }, [])

  const stopAudioMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close()
    setAudioLevel(0)
  }, [])

  const start = useCallback(() => {
    if (!recognitionRef.current) return
    recognitionRef.current.__shouldRun = true
    recognitionRef.current.start()
    setListening(true)
    startAudioMeter()
  }, [startAudioMeter])

  const stop = useCallback(() => {
    if (!recognitionRef.current) return
    recognitionRef.current.__shouldRun = false
    recognitionRef.current.stop()
    setListening(false)
    stopAudioMeter()
  }, [stopAudioMeter])

  const speak = useCallback((text) => {
    if (!window.speechSynthesis || !text) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.0
    window.speechSynthesis.speak(utterance)
  }, [])

  return { listening, interimText, supported, audioLevel, start, stop, speak }
}
