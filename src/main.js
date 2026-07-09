import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  PoseLandmarker,
} from '@mediapipe/tasks-vision'
import { env } from '@xenova/transformers'
import './style.css'
import {
  asrStatus,
  audioStatus,
  coachOutput,
  faceEnergyStatus,
  gazeWarning,
  gestureStatus,
  nlpStatus,
  noiseStatus,
  overlay,
  overlayCtx,
  reactionLayer,
  poseStatus,
  qualityStatus,
  startLiveBtn,
  thesesText,
  transcriptText,
  visionStatus,
  webcam,
} from './app/dom'
import { createAudioAnalyzer } from './app/audio'
import { createRecommendationsGenerator } from './app/recommendations'
import { createSessionStats } from './app/sessionStats'
import { createSpeechRecognitionController } from './app/speech'
import { latestSignals } from './app/state'
import { createTextAnalyzer } from './app/textAnalysis'
import { configureTransformersEnv } from './app/transformersConfig'
import { createVisionAnalyzer } from './app/vision'

configureTransformersEnv(env)

const sessionStats = createSessionStats()

const { startCamera, stopCamera } = createVisionAnalyzer({
  FilesetResolver,
  FaceLandmarker,
  PoseLandmarker,
  GestureRecognizer,
  webcam,
  overlay,
  overlayCtx,
  reactionLayer,
  visionStatus,
  gazeWarning,
  poseStatus,
  gestureStatus,
  faceEnergyStatus,
  latestSignals,
  sessionStats,
})

const { startMicrophone, stopMicrophone } = createAudioAnalyzer({
  audioStatus,
  noiseStatus,
  qualityStatus,
  latestSignals,
  sessionStats,
})

const { analyzeText, scheduleAutoTextAnalysis } = createTextAnalyzer({
  thesesText,
  transcriptText,
  nlpStatus,
  latestSignals,
  onAnalyzed: () => {
    generateRecommendations().catch((error) => {
      coachOutput.textContent = `Ошибка формирования отчёта: ${error.message}`
    })
  },
})

const { startSpeechRecognition, stopSpeechRecognition } = createSpeechRecognitionController({
  transcriptText,
  asrStatus,
  onTranscriptFinalized: scheduleAutoTextAnalysis,
})

const { generateRecommendations } = createRecommendationsGenerator({
  coachOutput,
  latestSignals,
  sessionStats,
})
let liveStarted = false

thesesText.addEventListener('input', scheduleAutoTextAnalysis)

startLiveBtn.addEventListener('click', async () => {
  startLiveBtn.disabled = true
  if (liveStarted) {
    stopSpeechRecognition()
    await stopMicrophone()
    stopCamera()
    sessionStats.stop()
    visionStatus.textContent = 'Модели зрения: остановлены'
    if (asrStatus) {
      asrStatus.textContent = 'Речь: остановлено.'
    }
    liveStarted = false
    startLiveBtn.textContent = 'Запустить live-анализ'

    coachOutput.textContent = 'Формирую итоговый анализ выступления...'
    let textAnalyzed = false
    try {
      textAnalyzed = await analyzeText()
    } catch (error) {
      nlpStatus.textContent = `Ошибка анализа текста: ${error.message}`
    }

    if (!textAnalyzed) {
      try {
        await generateRecommendations()
      } catch (error) {
        coachOutput.textContent = `Ошибка формирования отчёта: ${error.message}`
      }
    }

    startLiveBtn.disabled = false
    return
  }

  sessionStats.start()
  let hasErrors = false

  try {
    await startCamera()
    visionStatus.textContent = 'Модели зрения: работают'
  } catch (error) {
    hasErrors = true
    visionStatus.textContent = 'Модели зрения: ошибка'
    gazeWarning.textContent = `Ошибка Vision: ${error.message}`
  }

  try {
    await startMicrophone()
  } catch (error) {
    hasErrors = true
    if (audioStatus) {
      audioStatus.textContent = `Аудио-анализатор: ошибка (${error.message})`
    }
  }

  const asrStarted = startSpeechRecognition()
  if (!asrStarted) {
    hasErrors = true
  }

  if (!hasErrors) {
    liveStarted = true
    startLiveBtn.textContent = 'Остановить live-анализ'
  } else {
    sessionStats.stop()
  }

  startLiveBtn.disabled = false
})
