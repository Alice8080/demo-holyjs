import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  PoseLandmarker,
} from '@mediapipe/tasks-vision'
import { env, pipeline } from '@xenova/transformers'
import './style.css'

// In Vite SPA, unresolved local model paths return index.html.
// Force Transformers.js to use remote model loading from Hugging Face Hub.
env.allowLocalModels = false
env.allowRemoteModels = true
env.useBrowserCache = true
env.remoteHost = 'https://huggingface.co/'

const webcam = document.querySelector('#webcam')
const overlay = document.querySelector('#overlay')
const overlayCtx = overlay.getContext('2d')
const startCameraBtn = document.querySelector('#start-camera')
const startMicBtn = document.querySelector('#start-mic')
const toggleAsrBtn = document.querySelector('#toggle-asr')
const analyzeTextBtn = document.querySelector('#analyze-text')
const generateRecommendationsBtn = document.querySelector('#generate-recommendations')

const visionStatus = document.querySelector('#vision-status')
const gazeWarning = document.querySelector('#gaze-warning')
const poseStatus = document.querySelector('#pose-status')
const gestureStatus = document.querySelector('#gesture-status')
const faceEnergyStatus = document.querySelector('#face-energy-status')

const audioStatus = document.querySelector('#audio-status')
const asrStatus = document.querySelector('#asr-status')
const noiseStatus = document.querySelector('#noise-status')
const qualityStatus = document.querySelector('#quality-status')

const thesesText = document.querySelector('#theses-text')
const transcriptText = document.querySelector('#transcript-text')
const nlpStatus = document.querySelector('#nlp-status')
const nlpResult = document.querySelector('#nlp-result')
const coachOutput = document.querySelector('#coach-output')

const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const GESTURE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'
const WASM_FILES_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const SENTIMENT_MODELS = [
  'onnx-community/rubert-tiny-sentiment-balanced-ONNX',
  'Xenova/bert-base-multilingual-uncased-sentiment',
]

let visionResolver
let faceLandmarker
let poseLandmarker
let gestureRecognizer
let sentimentPipeline
let sentimentBackend = 'unknown'
let sentimentModelId = 'unknown'

let videoStreamStarted = false
let lastVideoTime = -1
let offCameraFrames = 0
let prevNosePoint

let audioContext
let analyser
let micStream
let clippingFrames = 0
let totalAudioFrames = 0
let speechRecognition
let recognitionActive = false
let asrAutoAnalyzeTimer

const OFF_CAMERA_THRESHOLD = 6

const latestSignals = {
  vision: null,
  audio: null,
  text: null,
}

async function getVisionResolver() {
  if (visionResolver) {
    return visionResolver
  }
  visionResolver = await FilesetResolver.forVisionTasks(WASM_FILES_URL)
  return visionResolver
}

async function initVisionModels() {
  if (faceLandmarker && poseLandmarker && gestureRecognizer) {
    return
  }

  visionStatus.textContent = 'Модели зрения: загрузка...'
  const resolver = await getVisionResolver()

  if (!faceLandmarker) {
    faceLandmarker = await FaceLandmarker.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    })
  }

  if (!poseLandmarker) {
    poseLandmarker = await PoseLandmarker.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL },
      runningMode: 'VIDEO',
      numPoses: 1,
    })
  }

  if (!gestureRecognizer) {
    gestureRecognizer = await GestureRecognizer.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: GESTURE_MODEL_URL },
      runningMode: 'VIDEO',
      numHands: 2,
    })
  }

  visionStatus.textContent = 'Модели зрения: готовы (WASM)'
}

async function initSentimentPipeline() {
  if (sentimentPipeline) {
    return sentimentPipeline
  }

  nlpStatus.textContent = 'Текстовая модель: загрузка...'
  const devices = navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']
  const errors = []

  for (const modelId of SENTIMENT_MODELS) {
    for (const device of devices) {
      try {
        nlpStatus.textContent = `Текстовая модель: пробуем ${modelId} (${device})...`
        sentimentPipeline = await pipeline('sentiment-analysis', modelId, { device })
        sentimentBackend = device
        sentimentModelId = modelId
        nlpStatus.textContent = `Текстовая модель: готова (${device}, ${modelId})`
        return sentimentPipeline
      } catch (error) {
        errors.push(`${modelId} on ${device}: ${error.message}`)
      }
    }
  }

  throw new Error(
    `Не удалось загрузить модели sentiment. Вероятно, CDN/Hub вернул HTML вместо JSON. ${errors.join(
      ' | ',
    )}`,
  )
}

function toPixelPoint(point) {
  return {
    x: point.x * webcam.videoWidth,
    y: point.y * webcam.videoHeight,
  }
}

function getFaceBox(landmarks) {
  if (!landmarks || landmarks.length === 0) {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const landmark of landmarks) {
    const { x, y } = toPixelPoint(landmark)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  return {
    originX: minX,
    originY: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function estimateGaze(landmarks) {
  if (!landmarks || landmarks.length < 474) {
    return { onCamera: false }
  }

  const leftEyeOuter = toPixelPoint(landmarks[33])
  const leftEyeInner = toPixelPoint(landmarks[133])
  const rightEyeInner = toPixelPoint(landmarks[362])
  const rightEyeOuter = toPixelPoint(landmarks[263])
  const leftIris = toPixelPoint(landmarks[468])
  const rightIris = toPixelPoint(landmarks[473])
  const noseTip = toPixelPoint(landmarks[1])

  const eyeMidX = (leftEyeInner.x + rightEyeInner.x) / 2
  const eyeDistance = Math.max(1, Math.abs(rightEyeInner.x - leftEyeInner.x))
  const headYaw = Math.abs(noseTip.x - eyeMidX) / eyeDistance

  const leftMin = Math.min(leftEyeOuter.x, leftEyeInner.x)
  const leftMax = Math.max(leftEyeOuter.x, leftEyeInner.x)
  const rightMin = Math.min(rightEyeOuter.x, rightEyeInner.x)
  const rightMax = Math.max(rightEyeOuter.x, rightEyeInner.x)

  const leftIrisRatio = (leftIris.x - leftMin) / Math.max(1, leftMax - leftMin)
  const rightIrisRatio = (rightIris.x - rightMin) / Math.max(1, rightMax - rightMin)
  const irisOffset = Math.abs((leftIrisRatio + rightIrisRatio) / 2 - 0.5)

  return { onCamera: !(headYaw > 0.19 || irisOffset > 0.19) }
}

function updateGazeWarning(landmarks) {
  if (!landmarks) {
    offCameraFrames += 2
  } else {
    const gaze = estimateGaze(landmarks)
    offCameraFrames = gaze.onCamera ? Math.max(0, offCameraFrames - 2) : offCameraFrames + 1
  }

  const offCamera = offCameraFrames >= OFF_CAMERA_THRESHOLD
  gazeWarning.className = offCamera ? 'gaze-alert' : 'gaze-ok'
  gazeWarning.textContent = !landmarks && offCamera
    ? 'Взгляд: лицо вышло из кадра.'
    : offCamera
      ? 'Взгляд: чаще смотри в камеру.'
      : 'Взгляд: хороший eye contact.'

  return !offCamera
}

function analyzePose(poseLandmarks) {
  if (!poseLandmarks || poseLandmarks.length < 13) {
    poseStatus.textContent = 'Поза: человек не обнаружен.'
    return { isOpen: false, warning: 'Нет данных по позе.' }
  }

  const leftShoulder = toPixelPoint(poseLandmarks[11])
  const rightShoulder = toPixelPoint(poseLandmarks[12])
  const nose = toPixelPoint(poseLandmarks[0])

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2
  const shoulderWidth = Math.max(1, Math.abs(rightShoulder.x - leftShoulder.x))
  const torsoTilt = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth
  const headOffset = Math.abs(nose.x - shoulderMidX) / shoulderWidth

  let warning = 'Поза стабильная.'
  if (torsoTilt > 0.2) {
    warning = 'Плечи перекошены. Выпрями осанку.'
  } else if (headOffset > 0.5) {
    warning = 'Голова смещена. Вернись в центр.'
  }

  poseStatus.textContent = `Поза: ${warning}`
  return { isOpen: torsoTilt < 0.2, warning }
}

function analyzeGesture(gestureResult) {
  const topGesture = gestureResult?.gestures?.[0]?.[0]?.categoryName
  if (!topGesture || topGesture === 'None') {
    gestureStatus.textContent = 'Жесты: 🤲 низкая активность рук.'
    return { label: 'none', active: false }
  }

  const gestureView = {
    Thumbs_Up: '👍 палец вверх',
    Thumbs_Down: '👎 палец вниз',
    Open_Palm: '🖐 открытая ладонь',
    Closed_Fist: '✊ сжатый кулак',
    Pointing_Up: '☝ указательный вверх',
    Victory: '✌ жест победы',
    ILoveYou: '🤟 I love you',
  }

  gestureStatus.textContent = `Жесты: ${gestureView[topGesture] ?? `🤌 ${topGesture}`}`
  return { label: topGesture, active: true }
}

function analyzeFaceEnergy(landmarks) {
  if (!landmarks || landmarks.length < 16) {
    faceEnergyStatus.textContent = 'Активность лица: нет данных.'
    return { score: 0, level: 'low' }
  }

  const upperLip = toPixelPoint(landmarks[13])
  const lowerLip = toPixelPoint(landmarks[14])
  const leftCheek = toPixelPoint(landmarks[234])
  const rightCheek = toPixelPoint(landmarks[454])
  const nose = toPixelPoint(landmarks[1])

  const faceWidth = Math.max(1, Math.abs(rightCheek.x - leftCheek.x))
  const mouthOpen = Math.abs(lowerLip.y - upperLip.y) / faceWidth
  const motion = prevNosePoint
    ? Math.hypot(nose.x - prevNosePoint.x, nose.y - prevNosePoint.y) / faceWidth
    : 0

  prevNosePoint = nose
  const energyScore = Math.min(1, mouthOpen * 6 + motion * 7)
  const level = energyScore < 0.22 ? 'low' : energyScore < 0.45 ? 'medium' : 'high'
  const levelRu = level === 'low' ? 'низкая' : level === 'medium' ? 'средняя' : 'высокая'

  faceEnergyStatus.textContent = `Активность лица: ${levelRu} (${(energyScore * 100).toFixed(0)}%)`
  return { score: energyScore, level }
}

function drawOverlays(faceBox, poseLandmarks) {
  overlay.width = webcam.videoWidth
  overlay.height = webcam.videoHeight
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height)

  if (faceBox) {
    overlayCtx.strokeStyle = '#7c3aed'
    overlayCtx.lineWidth = 3
    overlayCtx.strokeRect(faceBox.originX, faceBox.originY, faceBox.width, faceBox.height)
  }

  if (poseLandmarks?.length > 12) {
    const leftShoulder = toPixelPoint(poseLandmarks[11])
    const rightShoulder = toPixelPoint(poseLandmarks[12])
    overlayCtx.strokeStyle = '#34d399'
    overlayCtx.lineWidth = 2
    overlayCtx.beginPath()
    overlayCtx.moveTo(leftShoulder.x, leftShoulder.y)
    overlayCtx.lineTo(rightShoulder.x, rightShoulder.y)
    overlayCtx.stroke()
  }
}

async function startCamera() {
  if (videoStreamStarted) {
    return
  }

  await initVisionModels()
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  webcam.srcObject = stream
  videoStreamStarted = true

  await new Promise((resolve) => {
    webcam.onloadeddata = resolve
  })

  const renderFrame = () => {
    if (!faceLandmarker || !poseLandmarker || !gestureRecognizer || webcam.videoWidth === 0) {
      requestAnimationFrame(renderFrame)
      return
    }

    if (webcam.currentTime !== lastVideoTime) {
      lastVideoTime = webcam.currentTime
      const now = performance.now()

      const faceResult = faceLandmarker.detectForVideo(webcam, now)
      const poseResult = poseLandmarker.detectForVideo(webcam, now)
      const gestureResult = gestureRecognizer.recognizeForVideo(webcam, now)

      const landmarks = faceResult.faceLandmarks?.[0]
      const faceBox = getFaceBox(landmarks)
      const poseLandmarks = poseResult.landmarks?.[0]
      drawOverlays(faceBox, poseLandmarks)

      const gazeGood = updateGazeWarning(landmarks)
      const poseInfo = analyzePose(poseLandmarks)
      const gestureInfo = analyzeGesture(gestureResult)
      const faceEnergy = analyzeFaceEnergy(landmarks)

      latestSignals.vision = {
        gazeGood,
        pose: poseInfo,
        gesture: gestureInfo,
        faceEnergy,
      }
    }

    requestAnimationFrame(renderFrame)
  }

  renderFrame()
}

function tokenizeRussianWords(text) {
  return (text.toLowerCase().match(/[а-яёa-z0-9]+/gi) || []).filter((word) => word.length > 2)
}

function scheduleAutoTextAnalysis() {
  clearTimeout(asrAutoAnalyzeTimer)
  asrAutoAnalyzeTimer = setTimeout(() => {
    if (transcriptText.value.trim()) {
      analyzeText().catch((error) => {
        nlpResult.textContent = `Ошибка автоанализа текста: ${error.message}`
      })
    }
  }, 900)
}

function computeTextStructure(theses, transcript) {
  const thesisList = theses
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const transcriptWords = new Set(tokenizeRussianWords(transcript))

  const coverageDetails = thesisList.map((thesis) => {
    const thesisWords = [...new Set(tokenizeRussianWords(thesis))]
    const matched = thesisWords.filter((word) => transcriptWords.has(word)).length
    const ratio = thesisWords.length === 0 ? 0 : matched / thesisWords.length
    return {
      thesis,
      coverage: Number((ratio * 100).toFixed(1)),
      covered: ratio >= 0.35,
    }
  })

  const coveredCount = coverageDetails.filter((item) => item.covered).length
  const thesisCoverage = thesisList.length === 0 ? 0 : coveredCount / thesisList.length

  const sentences = transcript
    .split(/[.!?]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
  const words = tokenizeRussianWords(transcript)
  const avgSentenceLength = sentences.length === 0 ? 0 : words.length / sentences.length

  const fillers = ['как бы', 'типа', 'значит', 'короче', 'в общем', 'ээ', 'эм']
  const transcriptLower = transcript.toLowerCase()
  const fillerHits = fillers.reduce((sum, phrase) => sum + (transcriptLower.split(phrase).length - 1), 0)

  const structureMarkers = ['во-первых', 'во-вторых', 'например', 'далее', 'итак', 'наконец', 'вывод']
  const markerHits = structureMarkers.filter((marker) => transcriptLower.includes(marker)).length

  let clarityScore = 100
  if (avgSentenceLength > 22) clarityScore -= 20
  if (avgSentenceLength < 6 && words.length > 30) clarityScore -= 10
  clarityScore -= Math.min(25, fillerHits * 4)
  clarityScore += Math.min(15, markerHits * 5)
  clarityScore = Math.max(0, Math.min(100, clarityScore))

  return {
    thesis_coverage_percent: Number((thesisCoverage * 100).toFixed(1)),
    covered_theses: coveredCount,
    total_theses: thesisList.length,
    avg_sentence_length: Number(avgSentenceLength.toFixed(1)),
    filler_words_count: fillerHits,
    structure_markers_found: markerHits,
    clarity_score: Number(clarityScore.toFixed(1)),
    coverage_details: coverageDetails,
  }
}

async function analyzeText() {
  const transcript = transcriptText.value.trim()
  const theses = thesesText.value.trim()

  if (!transcript) {
    nlpResult.textContent = 'Сначала добавьте текст транскрипта.'
    return
  }

  const sentiment = await initSentimentPipeline()
  const sentimentOutput = await sentiment(transcript)
  const topSentiment = sentimentOutput[0]
  const label = normalizeSentimentLabel(topSentiment.label)

  const structure = computeTextStructure(theses, transcript)
  const response = {
    sentiment: {
      label,
      confidence_percent: Number((topSentiment.score * 100).toFixed(1)),
      model: sentimentModelId,
      backend: sentimentBackend,
    },
    structure,
  }

  latestSignals.text = response
  nlpResult.textContent = JSON.stringify(response, null, 2)
}

function normalizeSentimentLabel(rawLabel) {
  const normalized = String(rawLabel).trim().toLowerCase()
  if (normalized.includes('negative')) return 'negative'
  if (normalized.includes('neutral')) return 'neutral'
  if (normalized.includes('positive')) return 'positive'

  const starsMatch = normalized.match(/([1-5])\s*star/)
  if (starsMatch) {
    const stars = Number(starsMatch[1])
    if (stars <= 2) return 'negative'
    if (stars === 3) return 'neutral'
    return 'positive'
  }

  return normalized
}

function getAudioLevelInfo(rms) {
  if (rms < 0.015) {
    return 'Слишком тихо'
  }
  if (rms > 0.12) {
    return 'Слишком шумно'
  }
  return 'Норма'
}

async function startMicrophone() {
  if (audioContext) {
    return
  }

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(micStream)
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)

  audioStatus.textContent = 'Аудио-анализатор: работает'
  const buffer = new Float32Array(analyser.fftSize)

  const tick = () => {
    analyser.getFloatTimeDomainData(buffer)
    let squareSum = 0
    let peak = 0

    for (const sample of buffer) {
      squareSum += sample * sample
      peak = Math.max(peak, Math.abs(sample))
    }

    const rms = Math.sqrt(squareSum / buffer.length)
    totalAudioFrames += 1
    if (peak > 0.97) {
      clippingFrames += 1
    }

    const clippingRate = totalAudioFrames === 0 ? 0 : clippingFrames / totalAudioFrames
    const noiseLevel = getAudioLevelInfo(rms)
    const quality =
      clippingRate > 0.12
        ? 'Обнаружен клиппинг. Уменьши усиление микрофона.'
        : rms < 0.01
          ? 'Сигнал слабый. Подойди ближе к микрофону.'
          : 'Качество микрофона в норме.'

    noiseStatus.textContent = `Шум: ${noiseLevel} (RMS ${rms.toFixed(3)})`
    qualityStatus.textContent = `Качество микрофона: ${quality}`

    latestSignals.audio = {
      rms: Number(rms.toFixed(4)),
      noiseLevel,
      clippingRate: Number((clippingRate * 100).toFixed(1)),
      quality,
    }

    requestAnimationFrame(tick)
  }

  tick()
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition
}

function initSpeechRecognition() {
  const SpeechRecognitionCtor = getSpeechRecognitionCtor()
  if (!SpeechRecognitionCtor) {
    asrStatus.textContent = 'Речь: API распознавания недоступно в этом браузере.'
    return null
  }

  if (speechRecognition) {
    return speechRecognition
  }

  speechRecognition = new SpeechRecognitionCtor()
  speechRecognition.continuous = true
  speechRecognition.interimResults = true
  speechRecognition.lang = 'ru-RU'

  speechRecognition.onstart = () => {
    recognitionActive = true
    toggleAsrBtn.textContent = 'Стоп распознавания'
    asrStatus.textContent = 'Речь: слушаю...'
  }

  speechRecognition.onresult = (event) => {
    let finalChunk = ''
    let interimChunk = ''

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0]?.transcript?.trim() || ''
      if (!text) continue
      if (event.results[i].isFinal) {
        finalChunk += `${text} `
      } else {
        interimChunk += `${text} `
      }
    }

    if (finalChunk) {
      transcriptText.value = `${transcriptText.value.trim()} ${finalChunk}`.trim()
      scheduleAutoTextAnalysis()
    }

    asrStatus.textContent = interimChunk
      ? `Речь: ${interimChunk.trim()}`
      : 'Речь: слушаю...'
  }

  speechRecognition.onerror = (event) => {
    asrStatus.textContent = `Речь: ошибка (${event.error})`
  }

  speechRecognition.onend = () => {
    if (recognitionActive) {
      speechRecognition.start()
      return
    }
    toggleAsrBtn.textContent = 'Старт распознавания'
    asrStatus.textContent = 'Речь: остановлено.'
  }

  return speechRecognition
}

function toggleSpeechRecognition() {
  const recognition = initSpeechRecognition()
  if (!recognition) {
    return
  }

  if (!recognitionActive) {
    recognitionActive = true
    recognition.start()
  } else {
    recognitionActive = false
    recognition.stop()
  }
}

function buildRuleBasedRecommendations() {
  const recommendations = []
  const vision = latestSignals.vision
  const audio = latestSignals.audio
  const text = latestSignals.text

  if (!vision || !audio || !text) {
    return 'Сначала запусти все анализаторы: Vision + Audio + Text.'
  }

  if (!vision.gazeGood) {
    recommendations.push('Чаще смотри прямо в камеру: держи взгляд на объективе хотя бы в ключевых тезисах.')
  }
  if (!vision.pose.isOpen) {
    recommendations.push('Стабилизируй позу: выровняй плечи и избегай наклонов корпуса.')
  }
  if (!vision.gesture.active) {
    recommendations.push('Добавь открытые жесты руками, чтобы речь выглядела живее.')
  }
  if (vision.faceEnergy.level === 'low') {
    recommendations.push('Повышай мимику и энергичность: делай акценты лицом на важных фразах.')
  }

  if (audio.noiseLevel === 'Слишком шумно') {
    recommendations.push('Слишком шумно: уменьши фоновый шум или используй направленный микрофон.')
  }
  if (audio.clippingRate > 12) {
    recommendations.push('Есть клиппинг по микрофону: снизь gain и говори чуть дальше от микрофона.')
  }

  if (text.structure.thesis_coverage_percent < 65) {
    recommendations.push('Покрытие тезисов низкое: проговори пропущенные пункты плана.')
  }
  if (text.structure.clarity_score < 60) {
    recommendations.push('Упрости структуру: короче предложения и больше явных маркеров "во-первых/итог".')
  }
  if (text.sentiment.label === 'negative') {
    recommendations.push('Тон слишком негативный: добавь поддерживающие и нейтральные формулировки.')
  }

  if (recommendations.length === 0) {
    recommendations.push('Выступление выглядит сбалансированным. Сохраняй темп и структуру.')
  }

  return recommendations.map((line, index) => `${index + 1}. ${line}`).join('\n')
}

async function generateRecommendations() {
  const payload = {
    vision: latestSignals.vision,
    audio: latestSignals.audio,
    text: latestSignals.text,
  }

  const promptApi = window.ai?.languageModel
  if (!promptApi) {
    coachOutput.textContent = buildRuleBasedRecommendations()
    return
  }

  try {
    const session = await promptApi.create({
      systemPrompt:
        'Ты помощник по подготовке доклада. Дай 4-6 практичных рекомендаций на русском в нумерованном списке.',
    })
    const prompt = `Сигналы анализаторов: ${JSON.stringify(payload)}`
    const completion = await session.prompt(prompt)
    coachOutput.textContent = completion
  } catch (error) {
    coachOutput.textContent = `${buildRuleBasedRecommendations()}\n\n(Prompt API fallback: ${error.message})`
  }
}

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
