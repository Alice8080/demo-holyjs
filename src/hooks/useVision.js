import { useRef } from 'react'
import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  PoseLandmarker,
} from '@mediapipe/tasks-vision'

const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const GESTURE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'
const WASM_FILES_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const OFF_CAMERA_THRESHOLD = 6

const GESTURE_EMOJI = {
  Thumbs_Up: '👍',
  Thumb_Up: '👍',
  Thumbs_Down: '👎',
  Thumb_Down: '👎',
  Open_Palm: '🖐',
  Closed_Fist: '✊',
  Pointing_Up: '☝',
  Victory: '✌',
  ILoveYou: '🤟',
}

const GESTURE_ALIASES = {
  thumbs_up: 'Thumbs_Up',
  thumb_up: 'Thumbs_Up',
  thumbs_down: 'Thumbs_Down',
  thumb_down: 'Thumbs_Down',
}

const GESTURE_VIEW = {
  Thumbs_Up: '👍 палец вверх',
  Thumbs_Down: '👎 палец вниз',
  Open_Palm: '🖐 открытая ладонь',
  Closed_Fist: '✊ сжатый кулак',
  Pointing_Up: '☝ указательный вверх',
  Victory: '✌ жест победы',
  ILoveYou: '🤟 I love you',
}

/**
 * Live-анализ видео: взгляд, поза, жесты и активность лица через MediaPipe.
 * Работает с уже смонтированными элементами <video>, <canvas> и слоем реакций.
 */
export function useVision({
  webcamRef,
  overlayRef,
  reactionLayerRef,
  setHud,
  setVisionStatus,
  latestSignals,
  sessionStats,
}) {
  const state = useRef({
    visionResolver: null,
    faceLandmarker: null,
    poseLandmarker: null,
    gestureRecognizer: null,
    videoStreamStarted: false,
    visionLoopActive: false,
    renderFrameId: 0,
    lastVideoTime: -1,
    offCameraFrames: 0,
    prevNosePoint: undefined,
    previousGestureLabel: 'none',
  })

  async function getVisionResolver() {
    if (state.current.visionResolver) {
      return state.current.visionResolver
    }
    state.current.visionResolver = await FilesetResolver.forVisionTasks(WASM_FILES_URL)
    return state.current.visionResolver
  }

  async function initVisionModels() {
    const s = state.current
    if (s.faceLandmarker && s.poseLandmarker && s.gestureRecognizer) {
      return
    }

    setVisionStatus('Модели зрения: загрузка...')
    const resolver = await getVisionResolver()

    if (!s.faceLandmarker) {
      s.faceLandmarker = await FaceLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      })
    }

    if (!s.poseLandmarker) {
      s.poseLandmarker = await PoseLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
    }

    if (!s.gestureRecognizer) {
      s.gestureRecognizer = await GestureRecognizer.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: GESTURE_MODEL_URL },
        runningMode: 'VIDEO',
        numHands: 2,
      })
    }

    setVisionStatus('Модели зрения: готовы (WASM)')
  }

  function toPixelPoint(point) {
    const webcam = webcamRef.current
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
    const s = state.current
    if (!landmarks) {
      s.offCameraFrames += 2
    } else {
      const gaze = estimateGaze(landmarks)
      s.offCameraFrames = gaze.onCamera
        ? Math.max(0, s.offCameraFrames - 2)
        : s.offCameraFrames + 1
    }

    const offCamera = s.offCameraFrames >= OFF_CAMERA_THRESHOLD
    const text =
      !landmarks && offCamera
        ? 'Взгляд: лицо вышло из кадра.'
        : offCamera
          ? 'Взгляд: чаще смотри в камеру.'
          : 'Взгляд: хороший eye contact.'

    setHud('gaze', text, offCamera ? 'bad' : 'good')
    return !offCamera
  }

  function analyzePose(poseLandmarks) {
    if (!poseLandmarks || poseLandmarks.length < 13) {
      setHud('pose', 'Поза: человек не обнаружен.', 'neutral')
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
    let isStable = true
    if (torsoTilt > 0.2) {
      warning = 'Плечи перекошены. Выпрями осанку.'
      isStable = false
    } else if (headOffset > 0.5) {
      warning = 'Голова смещена. Вернись в центр.'
      isStable = false
    }

    setHud('pose', `Поза: ${warning}`, isStable ? 'good' : 'bad')
    return { isOpen: torsoTilt < 0.2, warning }
  }

  function normalizeGestureLabel(label) {
    const value = String(label ?? '').trim()
    if (!value) {
      return ''
    }

    const aliasKey = value.toLowerCase().replace(/\s+/g, '_')
    return GESTURE_ALIASES[aliasKey] ?? value
  }

  function analyzeGesture(gestureResult) {
    const rawGesture = gestureResult?.gestures?.[0]?.[0]?.categoryName
    const topGesture = normalizeGestureLabel(rawGesture)
    if (!topGesture || topGesture === 'None') {
      setHud('gesture', 'Жесты: 🤲 низкая активность рук.', 'neutral')
      return { label: 'none', active: false }
    }

    setHud('gesture', `Жесты: ${GESTURE_VIEW[topGesture] ?? `🤌 ${topGesture}`}`, 'neutral')
    return { label: topGesture, active: true }
  }

  function getGestureAnchor(gestureResult) {
    const anchor = gestureResult?.landmarks?.[0]?.[0]
    if (!anchor) {
      return { x: 0.5, y: 0.5 }
    }

    return {
      x: Math.max(0, Math.min(1, anchor.x)),
      y: Math.max(0, Math.min(1, anchor.y)),
    }
  }

  function spawnGestureReaction(gestureLabel, anchor) {
    const reactionLayer = reactionLayerRef.current
    if (!reactionLayer) {
      return
    }

    const emoji = GESTURE_EMOJI[gestureLabel]
    if (!emoji) {
      return
    }

    const reaction = document.createElement('span')
    reaction.className = 'gesture-reaction'
    reaction.textContent = emoji
    reaction.style.left = `${(anchor.x * 100).toFixed(2)}%`
    reaction.style.top = `${(anchor.y * 100).toFixed(2)}%`

    reactionLayer.appendChild(reaction)
    reaction.addEventListener(
      'animationend',
      () => {
        reaction.remove()
      },
      { once: true },
    )
  }

  function handleGestureReaction(gestureInfo, gestureResult) {
    const s = state.current
    if (gestureInfo.label === s.previousGestureLabel) {
      return
    }

    s.previousGestureLabel = gestureInfo.label
    if (gestureInfo.label === 'none') {
      return
    }

    spawnGestureReaction(gestureInfo.label, getGestureAnchor(gestureResult))
  }

  function analyzeFaceEnergy(landmarks) {
    const s = state.current
    if (!landmarks || landmarks.length < 16) {
      setHud('faceEnergy', 'Активность лица: нет данных.', 'neutral')
      return { score: 0, level: 'low' }
    }

    const upperLip = toPixelPoint(landmarks[13])
    const lowerLip = toPixelPoint(landmarks[14])
    const leftCheek = toPixelPoint(landmarks[234])
    const rightCheek = toPixelPoint(landmarks[454])
    const nose = toPixelPoint(landmarks[1])

    const faceWidth = Math.max(1, Math.abs(rightCheek.x - leftCheek.x))
    const mouthOpen = Math.abs(lowerLip.y - upperLip.y) / faceWidth
    const motion = s.prevNosePoint
      ? Math.hypot(nose.x - s.prevNosePoint.x, nose.y - s.prevNosePoint.y) / faceWidth
      : 0

    s.prevNosePoint = nose
    const energyScore = Math.min(1, mouthOpen * 6 + motion * 7)
    const level = energyScore < 0.22 ? 'low' : energyScore < 0.45 ? 'medium' : 'high'
    const levelRu = level === 'low' ? 'низкая' : level === 'medium' ? 'средняя' : 'высокая'

    setHud(
      'faceEnergy',
      `Активность лица: ${levelRu} (${(energyScore * 100).toFixed(0)}%)`,
      level === 'low' ? 'bad' : 'good',
    )
    return { score: energyScore, level }
  }

  function drawOverlays(faceBox, poseLandmarks) {
    const webcam = webcamRef.current
    const overlay = overlayRef.current
    const overlayCtx = overlay.getContext('2d')

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
    const s = state.current
    if (s.videoStreamStarted) {
      return
    }

    await initVisionModels()
    const webcam = webcamRef.current
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    webcam.srcObject = stream
    s.videoStreamStarted = true
    s.visionLoopActive = true

    await new Promise((resolve) => {
      webcam.onloadeddata = resolve
    })

    const renderFrame = () => {
      if (!s.visionLoopActive) {
        return
      }

      if (!s.faceLandmarker || !s.poseLandmarker || !s.gestureRecognizer || webcam.videoWidth === 0) {
        s.renderFrameId = requestAnimationFrame(renderFrame)
        return
      }

      if (webcam.currentTime !== s.lastVideoTime) {
        s.lastVideoTime = webcam.currentTime
        const now = performance.now()

        const faceResult = s.faceLandmarker.detectForVideo(webcam, now)
        const poseResult = s.poseLandmarker.detectForVideo(webcam, now)
        const gestureResult = s.gestureRecognizer.recognizeForVideo(webcam, now)

        const landmarks = faceResult.faceLandmarks?.[0]
        const faceBox = getFaceBox(landmarks)
        const poseLandmarks = poseResult.landmarks?.[0]
        drawOverlays(faceBox, poseLandmarks)

        const gazeGood = updateGazeWarning(landmarks)
        const poseInfo = analyzePose(poseLandmarks)
        const gestureInfo = analyzeGesture(gestureResult)
        handleGestureReaction(gestureInfo, gestureResult)
        const faceEnergy = analyzeFaceEnergy(landmarks)

        latestSignals.current.vision = {
          gazeGood,
          pose: poseInfo,
          gesture: gestureInfo,
          faceEnergy,
        }

        sessionStats?.recordVision({
          gazeGood,
          poseDetected: poseInfo.warning !== 'Нет данных по позе.',
          poseStable: poseInfo.isOpen,
          faceDetected: Boolean(landmarks && landmarks.length >= 16),
          faceLevel: faceEnergy.level,
          faceScore: faceEnergy.score,
        })
      }

      s.renderFrameId = requestAnimationFrame(renderFrame)
    }

    renderFrame()
  }

  function stopCamera() {
    const s = state.current
    if (!s.videoStreamStarted) {
      return
    }

    s.visionLoopActive = false
    cancelAnimationFrame(s.renderFrameId)
    s.renderFrameId = 0

    const webcam = webcamRef.current
    const stream = webcam?.srcObject
    if (stream && stream.getTracks) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }

    if (webcam) {
      webcam.srcObject = null
    }
    s.videoStreamStarted = false
    s.lastVideoTime = -1
    s.offCameraFrames = 0
    s.prevNosePoint = undefined
    s.previousGestureLabel = 'none'

    setHud('gaze', 'Взгляд: ждем камеру...', 'neutral')
    setHud('pose', 'Поза: данных пока нет.', 'neutral')
    setHud('gesture', 'Жесты: данных пока нет.', 'neutral')
    setHud('faceEnergy', 'Активность лица: данных пока нет.', 'neutral')

    if (reactionLayerRef.current) {
      reactionLayerRef.current.textContent = ''
    }
    const overlay = overlayRef.current
    if (overlay) {
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height)
    }
  }

  return { startCamera, stopCamera }
}
