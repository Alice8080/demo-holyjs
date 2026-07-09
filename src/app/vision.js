const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const GESTURE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'
const WASM_FILES_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const OFF_CAMERA_THRESHOLD = 6

export function createVisionAnalyzer({
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
}) {
  let visionResolver
  let faceLandmarker
  let poseLandmarker
  let gestureRecognizer
  let videoStreamStarted = false
  let visionLoopActive = false
  let renderFrameId = 0
  let lastVideoTime = -1
  let offCameraFrames = 0
  let prevNosePoint
  let previousGestureLabel = 'none'

  const gestureEmoji = {
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

  const gestureAliases = {
    thumbs_up: 'Thumbs_Up',
    thumb_up: 'Thumbs_Up',
    thumbs_down: 'Thumbs_Down',
    thumb_down: 'Thumbs_Down',
  }

  function setHudState(element, state) {
    if (!element) {
      return
    }
    element.classList.remove('hud-good', 'hud-bad')
    if (state === 'good') {
      element.classList.add('hud-good')
    } else if (state === 'bad') {
      element.classList.add('hud-bad')
    }
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
    setHudState(gazeWarning, offCamera ? 'bad' : 'good')
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
      setHudState(poseStatus, 'neutral')
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

    poseStatus.textContent = `Поза: ${warning}`
    setHudState(poseStatus, isStable ? 'good' : 'bad')
    return { isOpen: torsoTilt < 0.2, warning }
  }

  function analyzeGesture(gestureResult) {
    const rawGesture = gestureResult?.gestures?.[0]?.[0]?.categoryName
    const topGesture = normalizeGestureLabel(rawGesture)
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

  function normalizeGestureLabel(label) {
    const value = String(label ?? '').trim()
    if (!value) {
      return ''
    }

    const aliasKey = value.toLowerCase().replace(/\s+/g, '_')
    return gestureAliases[aliasKey] ?? value
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
    if (!reactionLayer) {
      return
    }

    const emoji = gestureEmoji[gestureLabel]
    if (!emoji) {
      return
    }

    const reaction = document.createElement('span')
    reaction.className = 'gesture-reaction'
    reaction.textContent = emoji
    reaction.style.left = `${(anchor.x * 100).toFixed(2)}%`
    reaction.style.top = `${(anchor.y * 100).toFixed(2)}%`

    reactionLayer.appendChild(reaction)
    reaction.addEventListener('animationend', () => {
      reaction.remove()
    }, { once: true })
  }

  function handleGestureReaction(gestureInfo, gestureResult) {
    if (gestureInfo.label === previousGestureLabel) {
      return
    }

    previousGestureLabel = gestureInfo.label
    if (gestureInfo.label === 'none') {
      return
    }

    spawnGestureReaction(gestureInfo.label, getGestureAnchor(gestureResult))
  }

  function analyzeFaceEnergy(landmarks) {
    if (!landmarks || landmarks.length < 16) {
      faceEnergyStatus.textContent = 'Активность лица: нет данных.'
      setHudState(faceEnergyStatus, 'neutral')
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
    setHudState(faceEnergyStatus, level === 'low' ? 'bad' : 'good')
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
    visionLoopActive = true

    await new Promise((resolve) => {
      webcam.onloadeddata = resolve
    })

    const renderFrame = () => {
      if (!visionLoopActive) {
        return
      }

      if (!faceLandmarker || !poseLandmarker || !gestureRecognizer || webcam.videoWidth === 0) {
        renderFrameId = requestAnimationFrame(renderFrame)
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
        handleGestureReaction(gestureInfo, gestureResult)
        const faceEnergy = analyzeFaceEnergy(landmarks)

        latestSignals.vision = {
          gazeGood,
          pose: poseInfo,
          gesture: gestureInfo,
          faceEnergy,
        }
      }

      renderFrameId = requestAnimationFrame(renderFrame)
    }

    renderFrame()
  }

  function stopCamera() {
    if (!videoStreamStarted) {
      return
    }

    visionLoopActive = false
    cancelAnimationFrame(renderFrameId)
    renderFrameId = 0

    const stream = webcam.srcObject
    if (stream && stream.getTracks) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }

    webcam.srcObject = null
    videoStreamStarted = false
    lastVideoTime = -1
    offCameraFrames = 0
    prevNosePoint = undefined
    previousGestureLabel = 'none'
    setHudState(gazeWarning, 'neutral')
    setHudState(poseStatus, 'neutral')
    setHudState(gestureStatus, 'neutral')
    setHudState(faceEnergyStatus, 'neutral')
    if (reactionLayer) {
      reactionLayer.textContent = ''
    }
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
  }

  return { startCamera, stopCamera }
}
