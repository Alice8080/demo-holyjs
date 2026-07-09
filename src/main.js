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
  poseStatus,
  qualityStatus,
  startCameraBtn,
  startMicBtn,
  thesesText,
  toggleAsrBtn,
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

const { startCamera } = createVisionAnalyzer({
  FilesetResolver,
  FaceLandmarker,
  PoseLandmarker,
  GestureRecognizer,
  webcam,
  overlay,
  overlayCtx,
  visionStatus,
  gazeWarning,
  poseStatus,
  gestureStatus,
  faceEnergyStatus,
  latestSignals,
})

const { startMicrophone } = createAudioAnalyzer({
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

const { toggleSpeechRecognition } = createSpeechRecognitionController({
  transcriptText,
  asrStatus,
  toggleAsrBtn,
  onTranscriptFinalized: scheduleAutoTextAnalysis,
})

const { generateRecommendations } = createRecommendationsGenerator({ coachOutput, latestSignals })

startCameraBtn.addEventListener('click', async () => {
  startCameraBtn.disabled = true
  try {
    await startCamera()
    visionStatus.textContent = 'Модели зрения: работают'
  } catch (error) {
    visionStatus.textContent = 'Модели зрения: ошибка'
    gazeWarning.textContent = `Ошибка Vision: ${error.message}`
  } finally {
    startCameraBtn.disabled = false
  }
})

startMicBtn.addEventListener('click', async () => {
  startMicBtn.disabled = true
  try {
    await startMicrophone()
  } catch (error) {
    audioStatus.textContent = `Аудио-анализатор: ошибка (${error.message})`
  } finally {
    startMicBtn.disabled = false
  }
})

toggleAsrBtn.addEventListener('click', () => {
  toggleSpeechRecognition()
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
