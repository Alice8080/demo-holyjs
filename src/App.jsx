import { useCallback, useRef, useState } from 'react'
import LiveCard from './components/LiveCard'
import Report from './components/Report'
import { useAudio } from './hooks/useAudio'
import { useVision } from './hooks/useVision'
import { createSessionStats } from './lib/sessionStats'
import { buildSessionRecommendations } from './lib/recommendations'

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
  const latestSignals = useRef({ vision: null, audio: null })
  const sessionStatsRef = useRef(null)
  if (!sessionStatsRef.current) {
    sessionStatsRef.current = createSessionStats()
  }
  const sessionStats = sessionStatsRef.current

  const [liveStarted, setLiveStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hud, setHud] = useState(INITIAL_HUD)
  const [visionStatus, setVisionStatus] = useState('Vision-модели: ожидание загрузки')
  const [coach, setCoach] = useState('Отчёт появится после остановки live-анализа.')

  const updateHud = useCallback((key, text, state) => {
    setHud((prev) => ({ ...prev, [key]: { text, state } }))
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

  // Итоговый отчёт по Vision/Audio с эвристическими рекомендациями (локально, без LLM).
  const generateReport = useCallback(() => {
    const summary = sessionStats.summarize()

    if (!summary) {
      setCoach('Пока нет данных для анализа. Запусти live-анализ, затем сформируй отчёт.')
      return
    }

    setCoach({
      summary,
      recommendations: buildSessionRecommendations(summary),
    })
  }, [sessionStats])

  async function toggleLive() {
    setBusy(true)

    if (liveStarted) {
      await stopMicrophone()
      stopCamera()
      sessionStats.stop()
      setVisionStatus('Vision-модели: остановлены')
      setLiveStarted(false)
      setCoach('Формирую итоговый анализ выступления...')

      try {
        generateReport()
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
      setVisionStatus('Vision-модели: работают')
    } catch (error) {
      hasErrors = true
      setVisionStatus('Vision-модели: ошибка')
      updateHud('gaze', `Ошибка Vision: ${error.message}`, 'bad')
    }

    try {
      await startMicrophone()
    } catch (error) {
      hasErrors = true
      updateHud('quality', `Аудио-анализатор: ошибка (${error.message})`, 'bad')
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

          <article className="card">
            <h2>Итоговый анализ</h2>
            <p>
              Собирает сигналы из Vision/Audio и автоматически формирует итоговый отчёт после остановки
              live-анализа.
            </p>
            <Report content={coach} />
          </article>
        </section>

        <footer className="repo-footer">
          <p>
            Исходный код:{' '}
            <a href="https://github.com/Alice8080/demo-holyjs" target="_blank" rel="noreferrer">
              github.com/Alice8080/demo-holyjs
            </a>
          </p>
        </footer>
      </main>
    </div>
  )
}
