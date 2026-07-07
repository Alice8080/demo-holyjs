import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { pipeline } from '@xenova/transformers'
import './style.css'

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="layout">
    <header>
      <h1>Local AI/ML Presentation Coach</h1>
      <p>MediaPipe (vision) + Transformers.js (text) with backend fallback: WebGPU -> WASM.</p>
    </header>

    <section class="grid">
      <article class="card">
        <h2>Vision: Speaker Framing</h2>
        <div class="video-stack">
          <video id="webcam" autoplay playsinline muted></video>
          <canvas id="overlay"></canvas>
        </div>
        <div class="controls">
          <button id="start-camera">Start camera</button>
          <span id="vision-status" class="status">Vision model: idle</span>
        </div>
        <p id="vision-tip">Click "Start camera" to run on-device face detection.</p>
        <p id="gaze-warning" class="gaze-ok">Eye contact: waiting for camera...</p>
      </article>

      <article class="card">
        <h2>Text: Tone Analysis</h2>
        <textarea id="speech-text" rows="7" placeholder="Paste your speech draft or transcript"></textarea>
        <div class="controls">
          <button id="analyze-text">Analyze tone</button>
          <span id="nlp-status" class="status">Text model: idle</span>
        </div>
        <pre id="nlp-result">No analysis yet.</pre>
      </article>
    </section>
  </main>
`

const webcam = document.querySelector('#webcam')
const overlay = document.querySelector('#overlay')
const overlayCtx = overlay.getContext('2d')
const startCameraBtn = document.querySelector('#start-camera')
const analyzeTextBtn = document.querySelector('#analyze-text')
const speechText = document.querySelector('#speech-text')
const visionStatus = document.querySelector('#vision-status')
const nlpStatus = document.querySelector('#nlp-status')
const visionTip = document.querySelector('#vision-tip')
const gazeWarning = document.querySelector('#gaze-warning')
const nlpResult = document.querySelector('#nlp-result')

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const WASM_FILES_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'

let faceDetector
let sentimentPipeline
let streamStarted = false
let lastVideoTime = -1
let offCameraFrames = 0
const OFF_CAMERA_THRESHOLD = 14

async function initFaceDetector() {
  if (faceDetector) {
    return faceDetector
  }

  visionStatus.textContent = 'Vision model: loading...'
  const vision = await FilesetResolver.forVisionTasks(WASM_FILES_URL)
  faceDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
    },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.4,
  })
  visionStatus.textContent = 'Vision model: ready (WASM)'
  return faceDetector
}

async function initSentimentPipeline() {
  if (sentimentPipeline) {
    return sentimentPipeline
  }

  nlpStatus.textContent = 'Text model: loading...'

  try {
    if (!navigator.gpu) {
      throw new Error('WebGPU is unavailable')
    }
    sentimentPipeline = await pipeline(
      'sentiment-analysis',
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      { device: 'webgpu' },
    )
    nlpStatus.textContent = 'Text model: ready (WebGPU)'
    return sentimentPipeline
  } catch (webgpuError) {
    nlpStatus.textContent = 'Text model: WebGPU unavailable, switching to WASM...'
  }

  sentimentPipeline = await pipeline(
    'sentiment-analysis',
    'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    { device: 'wasm' },
  )
  nlpStatus.textContent = 'Text model: ready (WASM fallback)'
  return sentimentPipeline
}

function getFramingTip(detection) {
  if (!detection) {
    return 'No face detected. Move your face into the frame.'
  }

  const { originX, originY, width, height } = detection.boundingBox
  const centerX = originX + width / 2
  const centerY = originY + height / 2
  const offsetX = Math.abs(centerX - webcam.videoWidth / 2) / webcam.videoWidth
  const offsetY = Math.abs(centerY - webcam.videoHeight / 2) / webcam.videoHeight
  const sizeRatio = (width * height) / (webcam.videoWidth * webcam.videoHeight)

  if (sizeRatio < 0.04) {
    return 'You look far from the camera. Move a bit closer.'
  }
  if (sizeRatio > 0.45) {
    return 'You look too close to the camera. Step back slightly.'
  }
  if (offsetX > 0.15 || offsetY > 0.2) {
    return 'Center yourself in the frame for a more stable presence.'
  }

  return 'Framing looks good. Keep your current position.'
}

function toPixelPoint(keypoint) {
  const x = keypoint.x <= 1 ? keypoint.x * webcam.videoWidth : keypoint.x
  const y = keypoint.y <= 1 ? keypoint.y * webcam.videoHeight : keypoint.y
  return { x, y }
}

function estimateGaze(detection) {
  if (!detection?.keypoints || detection.keypoints.length < 2) {
    return { onCamera: true, confidence: 'low' }
  }

  const leftEye = toPixelPoint(detection.keypoints[0])
  const rightEye = toPixelPoint(detection.keypoints[1])
  const eyesMidX = (leftEye.x + rightEye.x) / 2
  const eyesMidY = (leftEye.y + rightEye.y) / 2

  const { originX, originY, width, height } = detection.boundingBox
  const boxCenterX = originX + width / 2
  const boxCenterY = originY + height / 2

  const normalizedOffsetX = Math.abs(eyesMidX - boxCenterX) / Math.max(width, 1)
  const normalizedOffsetY = Math.abs(eyesMidY - boxCenterY) / Math.max(height, 1)
  const interEyeDistance = Math.abs(rightEye.x - leftEye.x) / Math.max(width, 1)

  const turnedAway =
    normalizedOffsetX > 0.2 || normalizedOffsetY > 0.34 || interEyeDistance < 0.12

  return {
    onCamera: !turnedAway,
    confidence: 'medium',
  }
}

function updateGazeWarning(detection) {
  if (!detection) {
    offCameraFrames += 1
  } else {
    const gaze = estimateGaze(detection)
    offCameraFrames = gaze.onCamera ? Math.max(0, offCameraFrames - 2) : offCameraFrames + 1
  }

  const shouldWarn = offCameraFrames >= OFF_CAMERA_THRESHOLD
  gazeWarning.className = shouldWarn ? 'gaze-alert' : 'gaze-ok'
  gazeWarning.textContent = shouldWarn
    ? 'Warning: you are not looking at the camera.'
    : 'Eye contact: good.'
}

function drawDetections(detections) {
  overlay.width = webcam.videoWidth
  overlay.height = webcam.videoHeight
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height)

  for (const detection of detections) {
    const box = detection.boundingBox
    overlayCtx.strokeStyle = '#7c3aed'
    overlayCtx.lineWidth = 3
    overlayCtx.strokeRect(box.originX, box.originY, box.width, box.height)
  }
}

async function startCamera() {
  if (streamStarted) {
    return
  }

  await initFaceDetector()
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  webcam.srcObject = stream
  streamStarted = true

  await new Promise((resolve) => {
    webcam.onloadeddata = resolve
  })

  const renderFrame = () => {
    if (!faceDetector || webcam.videoWidth === 0) {
      requestAnimationFrame(renderFrame)
      return
    }

    if (webcam.currentTime !== lastVideoTime) {
      lastVideoTime = webcam.currentTime
      const result = faceDetector.detectForVideo(webcam, performance.now())
      const detections = result.detections || []
      drawDetections(detections)
      const topDetection = detections[0]
      visionTip.textContent = getFramingTip(topDetection)
      updateGazeWarning(topDetection)
    }

    requestAnimationFrame(renderFrame)
  }

  renderFrame()
}

async function analyzeText() {
  const text = speechText.value.trim()
  if (!text) {
    nlpResult.textContent = 'Paste your speech text first.'
    return
  }

  const sentiment = await initSentimentPipeline()
  const output = await sentiment(text)
  const top = output[0]
  const scorePercent = (top.score * 100).toFixed(1)

  nlpResult.textContent = JSON.stringify(
    {
      label: top.label,
      confidence_percent: Number(scorePercent),
      recommendation:
        top.label === 'NEGATIVE'
          ? 'Tone looks strict. Consider softer phrasing and more positive framing.'
          : 'Tone looks audience-friendly. Keep this style for key statements.',
    },
    null,
    2,
  )
}

startCameraBtn.addEventListener('click', async () => {
  startCameraBtn.disabled = true
  try {
    await startCamera()
    visionStatus.textContent = 'Vision model: running'
  } catch (error) {
    visionStatus.textContent = 'Vision model: failed to start'
    visionTip.textContent = `Camera or model error: ${error.message}`
  } finally {
    startCameraBtn.disabled = false
  }
})

analyzeTextBtn.addEventListener('click', async () => {
  analyzeTextBtn.disabled = true
  try {
    await analyzeText()
  } catch (error) {
    nlpResult.textContent = `Text analysis failed: ${error.message}`
  } finally {
    analyzeTextBtn.disabled = false
  }
})
