import { useCallback, useEffect, useRef, useState } from 'react'
import { env } from '@xenova/transformers'
import LiveCard from './components/LiveCard'
import TextCard from './components/TextCard'
import Report from './components/Report'
import { useAudio } from './hooks/useAudio'
import { useSpeech } from './hooks/useSpeech'
import { useTextAnalysis } from './hooks/useTextAnalysis'
import { useVision } from './hooks/useVision'
import { createSessionStats } from './lib/sessionStats'
import { buildSessionRecommendations, requestLlmRecommendations } from './lib/recommendations'
import { configureTransformersEnv } from './lib/transformersConfig'

const INITIAL_HUD = {
  gaze: { text: 'Взгляд: ждем камеру...', state: 'neutral' },
  pose: { text: 'Поза: данных пока нет.', state: 'neutral' },
  faceEnergy: { text: 'Активность лица: данных пока нет.', state: 'neutral' },
  noise: { text: 'Шум: данных пока нет.', state: 'neutral' },
  quality: { text: 'Качество микрофона: данных пока нет.', state: 'neutral' },
  gesture: { text: 'Жесты: данных пока нет.', state: 'neutral' },
}

export default function App() {
  const webcamRef = useRef(null)
  const overlayRef = useRef(null)
  const reactionLayerRef = useRef(null)
  const latestSignals = useRef({ vision: null, audio: null, text: null })
  const sessionStatsRef = useRef(null)
  if (!sessionStatsRef.current) {
    sessionStatsRef.current = createSessionStats()
  }
  const sessionStats = sessionStatsRef.current

  const [theses, setTheses] = useState('')
  const [transcript, setTranscript] = useState('')
  const [liveStarted, setLiveStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hud, setHud] = useState(INITIAL_HUD)
  const [visionStatus, setVisionStatus] = useState('Модели зрения: ожидание')
  const [nlpStatus, setNlpStatus] = useState('Текстовая модель: ожидание')
  const [asrStatus, setAsrStatus] = useState('')
  const [coach, setCoach] = useState('Отчёт появится после остановки live-анализа.')

  useEffect(() => {
    configureTransformersEnv(env)
  }, [])

  const updateHud = useCallback((key, text, state) => {
    setHud((prev) => ({ ...prev, [key]: { text, state } }))
  }, [])

  const handleTranscript = useCallback((chunk) => {
    setTranscript((prev) => `${prev} ${chunk}`.trim())
  }, [])

  const { startCamera, stopCamera } = useVision({
    webcamRef,
    overlayRef,
    reactionLayerRef,
    setHud: updateHud,
    setVisionStatus,
    latestSignals,
    sessionStats,
  })

  const { startMicrophone, stopMicrophone } = useAudio({
    setHud: updateHud,
    latestSignals,
    sessionStats,
  })

  const { startSpeechRecognition, stopSpeechRecognition } = useSpeech({
    onTranscript: handleTranscript,
    setAsrStatus,
  })

  const { analyzeText } = useTextAnalysis({ setNlpStatus })

  const generateReport = useCallback(async () => {
    const summary = sessionStats.summarize()
    const text = latestSignals.current.text

    if (!summary && !text) {
      setCoach(
        'Пока нет данных для анализа. Запусти live-анализ и/или проанализируй текст, затем сформируй отчёт.',
      )
      return
    }

    const recommendations = buildSessionRecommendations(summary, text)
    const llmText = await requestLlmRecommendations(summary, text)
    setCoach({ summary, text, recommendations, llmText })
  }, [sessionStats])

  useEffect(() => {
    if (!transcript.trim()) {
      return undefined
    }

    const timer = setTimeout(() => {
      analyzeText(theses, transcript)
        .then((result) => {
          if (result) {
            latestSignals.current.text = result
            return generateReport()
          }
          return undefined
        })
        .catch((error) => setNlpStatus(`Ошибка автоанализа текста: ${error.message}`))
    }, 900)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theses, transcript])

  async function toggleLive() {
    setBusy(true)

    if (liveStarted) {
      stopSpeechRecognition()
      await stopMicrophone()
      stopCamera()
      sessionStats.stop()
      setVisionStatus('Модели зрения: остановлены')
      setAsrStatus('Речь: остановлено.')
      setLiveStarted(false)
      setCoach('Формирую итоговый анализ выступления...')

      try {
        const result = await analyzeText(theses, transcript)
        if (result) {
          latestSignals.current.text = result
        }
      } catch (error) {
        setNlpStatus(`Ошибка анализа текста: ${error.message}`)
      }

      try {
        await generateReport()
      } catch (error) {
        setCoach(`Ошибка формирования отчёта: ${error.message}`)
      }

      setBusy(false)
      return
    }

    sessionStats.start()
    let hasErrors = false

    try {
      await startCamera()
      setVisionStatus('Модели зрения: работают')
    } catch (error) {
      hasErrors = true
      setVisionStatus('Модели зрения: ошибка')
      updateHud('gaze', `Ошибка Vision: ${error.message}`, 'bad')
    }

    try {
      await startMicrophone()
    } catch (error) {
      hasErrors = true
      updateHud('quality', `Аудио-анализатор: ошибка (${error.message})`, 'bad')
    }

    const asrStarted = startSpeechRecognition()
    if (!asrStarted) {
      hasErrors = true
    }

    if (!hasErrors) {
      setLiveStarted(true)
    } else {
      sessionStats.stop()
    }

    setBusy(false)
  }

  return (
    <div className="app">
      <main className="layout">
        <header>
          <h1>Local Presentation Coach</h1>
          <p>Работает локально в браузере, данные не покидают ваше устройство.</p>
        </header>

        <section className="grid">
          <LiveCard
            webcamRef={webcamRef}
            overlayRef={overlayRef}
            reactionLayerRef={reactionLayerRef}
            hud={hud}
            visionStatus={visionStatus}
            liveStarted={liveStarted}
            busy={busy}
            onToggleLive={toggleLive}
          />

          <TextCard
            theses={theses}
            onThesesChange={setTheses}
            transcript={transcript}
            asrStatus={asrStatus}
            nlpStatus={nlpStatus}
          />

          <article className="card">
            <h2>LLM-агрегатор</h2>
            <p>
              Собирает сигналы из Vision/Audio/Text и автоматически формирует итоговый отчёт после остановки
              live-анализа.
            </p>
            <Report content={coach} />
          </article>
        </section>
      </main>
    </div>
  )
}
