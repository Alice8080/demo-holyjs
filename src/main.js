import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  PoseLandmarker,
} from '@mediapipe/tasks-vision'
import { env } from '@xenova/transformers'
import './style.css'
import {
  analyzeTextBtn,
  asrStatus,
  audioStatus,
  coachOutput,
  faceEnergyStatus,
  gazeWarning,
  generateRecommendationsBtn,
  gestureStatus,
  nlpResult,
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
import { createSpeechRecognitionController } from './app/speech'
import { latestSignals } from './app/state'
import { createTextAnalyzer } from './app/textAnalysis'
import { configureTransformersEnv } from './app/transformersConfig'
import { createVisionAnalyzer } from './app/vision'

configureTransformersEnv(env)

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
})

const { startMicrophone, stopMicrophone } = createAudioAnalyzer({
  audioStatus,
  noiseStatus,
  qualityStatus,
  latestSignals,
})

const { analyzeText, scheduleAutoTextAnalysis } = createTextAnalyzer({
  thesesText,
  transcriptText,
  nlpStatus,
  nlpResult,
  latestSignals,
})

const { startSpeechRecognition, stopSpeechRecognition } = createSpeechRecognitionController({
  transcriptText,
  asrStatus,
  onTranscriptFinalized: scheduleAutoTextAnalysis,
})

const { generateRecommendations } = createRecommendationsGenerator({ coachOutput, latestSignals })
let liveStarted = false

startLiveBtn.addEventListener('click', async () => {
  startLiveBtn.disabled = true
  if (liveStarted) {
    stopSpeechRecognition()
    await stopMicrophone()
    stopCamera()
    visionStatus.textContent = 'Модели зрения: остановлены'
    asrStatus.textContent = 'Речь: остановлено.'
    liveStarted = false
    startLiveBtn.textContent = 'Запустить live-анализ'
    startLiveBtn.disabled = false
    return
  }

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
    audioStatus.textContent = `Аудио-анализатор: ошибка (${error.message})`
  }

  const asrStarted = startSpeechRecognition()
  if (!asrStarted) {
    hasErrors = true
  }

  if (!hasErrors) {
    liveStarted = true
    startLiveBtn.textContent = 'Остановить live-анализ'
  }

  startLiveBtn.disabled = false
})

analyzeTextBtn.addEventListener('click', async () => {
  analyzeTextBtn.disabled = true
  try {
    await analyzeText()
  } catch (error) {
    nlpResult.textContent = `Ошибка анализа текста: ${error.message}`
  } finally {
    analyzeTextBtn.disabled = false
  }
})

generateRecommendationsBtn.addEventListener('click', async () => {
  generateRecommendationsBtn.disabled = true
  try {
    await generateRecommendations()
  } finally {
    generateRecommendationsBtn.disabled = false
  }
})
