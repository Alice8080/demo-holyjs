const MAX_FRAME_GAP_MS = 2000

function createEmptyData() {
  return {
    startedAt: null,
    endedAt: null,
    vision: {
      lastTs: null,
      gazeOnMs: 0,
      gazeOffMs: 0,
      poseMs: 0,
      poseStableMs: 0,
      faceLowMs: 0,
      faceMediumMs: 0,
      faceHighMs: 0,
      faceEnergySum: 0,
      faceSamples: 0,
    },
    audio: {
      frames: 0,
      noiseOkFrames: 0,
      quietFrames: 0,
      loudFrames: 0,
      qualityOkFrames: 0,
      rmsSum: 0,
      maxClippingRate: 0,
    },
  }
}

export function createSessionStats() {
  let data = createEmptyData()
  let active = false

  function start() {
    data = createEmptyData()
    data.startedAt = performance.now()
    data.vision.lastTs = null
    active = true
  }

  function stop() {
    if (!active) {
      return
    }
    active = false
    data.endedAt = performance.now()
  }

  function recordVision(sample) {
    if (!active) {
      return
    }

    const v = data.vision
    const now = performance.now()
    const dt = v.lastTs == null ? 0 : now - v.lastTs
    v.lastTs = now

    if (dt > 0 && dt < MAX_FRAME_GAP_MS) {
      if (sample.gazeGood) {
        v.gazeOnMs += dt
      } else {
        v.gazeOffMs += dt
      }

      if (sample.poseDetected) {
        v.poseMs += dt
        if (sample.poseStable) {
          v.poseStableMs += dt
        }
      }

      if (sample.faceDetected) {
        if (sample.faceLevel === 'high') {
          v.faceHighMs += dt
        } else if (sample.faceLevel === 'medium') {
          v.faceMediumMs += dt
        } else {
          v.faceLowMs += dt
        }
      }
    }

    if (sample.faceDetected) {
      v.faceEnergySum += sample.faceScore
      v.faceSamples += 1
    }
  }

  function recordAudio(sample) {
    if (!active) {
      return
    }

    const a = data.audio
    a.frames += 1
    if (sample.noiseLevel === 'Норма') {
      a.noiseOkFrames += 1
    } else if (sample.noiseLevel === 'Слишком тихо') {
      a.quietFrames += 1
    } else if (sample.noiseLevel === 'Слишком шумно') {
      a.loudFrames += 1
    }

    if (sample.qualityOk) {
      a.qualityOkFrames += 1
    }

    a.rmsSum += sample.rms
    a.maxClippingRate = Math.max(a.maxClippingRate, sample.clippingRate)
  }

  function summarize() {
    if (data.startedAt == null) {
      return null
    }

    const end = data.endedAt ?? performance.now()
    const durationSec = Math.max(0, (end - data.startedAt) / 1000)
    const v = data.vision
    const a = data.audio

    const gazeTotal = v.gazeOnMs + v.gazeOffMs
    const faceBuckets = v.faceLowMs + v.faceMediumMs + v.faceHighMs

    const percent = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0)
    const seconds = (ms) => Number((ms / 1000).toFixed(1))

    return {
      durationSec: Number(durationSec.toFixed(1)),
      hasVision: gazeTotal > 0,
      hasAudio: a.frames > 0,
      vision: {
        gaze: {
          onCameraPercent: percent(v.gazeOnMs, gazeTotal),
          offCameraPercent: percent(v.gazeOffMs, gazeTotal),
          onCameraSec: seconds(v.gazeOnMs),
          offCameraSec: seconds(v.gazeOffMs),
        },
        pose: {
          stablePercent: percent(v.poseStableMs, v.poseMs),
          unstablePercent: percent(v.poseMs - v.poseStableMs, v.poseMs),
          detectedSec: seconds(v.poseMs),
        },
        faceEnergy: {
          avgPercent: v.faceSamples > 0 ? Number(((v.faceEnergySum / v.faceSamples) * 100).toFixed(1)) : 0,
          lowPercent: percent(v.faceLowMs, faceBuckets),
          mediumPercent: percent(v.faceMediumMs, faceBuckets),
          highPercent: percent(v.faceHighMs, faceBuckets),
        },
      },
      audio: {
        normalPercent: percent(a.noiseOkFrames, a.frames),
        quietPercent: percent(a.quietFrames, a.frames),
        loudPercent: percent(a.loudFrames, a.frames),
        qualityOkPercent: percent(a.qualityOkFrames, a.frames),
        avgRms: a.frames > 0 ? Number((a.rmsSum / a.frames).toFixed(4)) : 0,
        maxClippingRate: Number(a.maxClippingRate.toFixed(1)),
      },
    }
  }

  return { start, stop, recordVision, recordAudio, summarize, isActive: () => active }
}
