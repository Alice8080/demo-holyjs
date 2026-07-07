import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
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
        <p id="vision-tip">Click "Start camera" to run on-device face landmarks.</p>
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
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const WASM_FILES_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'

let faceLandmarker
let sentimentPipeline
let streamStarted = false
let lastVideoTime = -1
let offCameraFrames = 0
const OFF_CAMERA_THRESHOLD = 6

async function initFaceLandmarker() {
  if (faceLandmarker) {
    return faceLandmarker
  }

  visionStatus.textContent = 'Vision model: loading...'
  const vision = await FilesetResolver.forVisionTasks(WASM_FILES_URL)
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
    },
    runningMode: 'VIDEO',
    numFaces: 1,
  })
  visionStatus.textContent = 'Vision model: ready (WASM)'
  return faceLandmarker
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

function toPixelPoint(point) {
  return {
    x: point.x * webcam.videoWidth,
    y: point.y * webcam.videoHeight,
  }
}

function getFaceBox(landmarks) {
  if (!landmarks || landmarks.length === 0) {
    return undefined
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

function getFramingTip(faceBox) {
  if (!faceBox) {
    return 'No face detected. Move your face into the frame.'
  }

  const { originX, originY, width, height } = faceBox
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

function estimateGaze(landmarks) {
  // Approximation: use nose-eye alignment + iris position in eye contours.
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

  const turnedAway = headYaw > 0.19 || irisOffset > 0.19
  return { onCamera: !turnedAway }
}

function updateGazeWarning(landmarks) {
  if (!landmarks) {
    offCameraFrames += 2
  } else {
    const gaze = estimateGaze(landmarks)
    offCameraFrames = gaze.onCamera ? Math.max(0, offCameraFrames - 2) : offCameraFrames + 1
  }

  const shouldWarn = offCameraFrames >= OFF_CAMERA_THRESHOLD
  gazeWarning.className = shouldWarn ? 'gaze-alert' : 'gaze-ok'

  if (!landmarks && shouldWarn) {
    gazeWarning.textContent = 'Warning: face is out of frame.'
    return
  }

  gazeWarning.textContent = shouldWarn
    ? 'Warning: you are not looking at the camera.'
    : 'Eye contact: good.'
}

function drawFaceBox(faceBox) {
  overlay.width = webcam.videoWidth
  overlay.height = webcam.videoHeight
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height)

  if (!faceBox) {
    return
  }

  overlayCtx.strokeStyle = '#7c3aed'
  overlayCtx.lineWidth = 3
  overlayCtx.strokeRect(faceBox.originX, faceBox.originY, faceBox.width, faceBox.height)
}

async function startCamera() {
  if (streamStarted) {
    return
  }

  await initFaceLandmarker()
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  webcam.srcObject = stream
  streamStarted = true

  await new Promise((resolve) => {
    webcam.onloadeddata = resolve
  })

  const renderFrame = () => {
    if (!faceLandmarker || webcam.videoWidth === 0 || webcam.videoHeight === 0) {
      requestAnimationFrame(renderFrame)
      return
    }

    if (webcam.currentTime !== lastVideoTime) {
      lastVideoTime = webcam.currentTime
      const result = faceLandmarker.detectForVideo(webcam, performance.now())
      const landmarks = result.faceLandmarks?.[0]
      const faceBox = getFaceBox(landmarks)
      drawFaceBox(faceBox)
      visionTip.textContent = getFramingTip(faceBox)
      updateGazeWarning(landmarks)
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
