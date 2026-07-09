function getAudioLevelInfo(rms) {
  if (rms < 0.015) {
    return 'Слишком тихо'
  }
  if (rms > 0.12) {
    return 'Слишком шумно'
  }
  return 'Норма'
}

export function createAudioAnalyzer({
  audioStatus,
  noiseStatus,
  qualityStatus,
  latestSignals,
}) {
  let audioContext
  let analyser
  let micStream
  let audioLoopActive = false
  let tickFrameId = 0
  let clippingFrames = 0
  let totalAudioFrames = 0

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
    audioLoopActive = true

    audioStatus.textContent = 'Аудио-анализатор: работает'
    const buffer = new Float32Array(analyser.fftSize)

    const tick = () => {
      if (!audioLoopActive) {
        return
      }

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

      tickFrameId = requestAnimationFrame(tick)
    }

    tick()
  }

  async function stopMicrophone() {
    if (!audioContext) {
      return
    }

    audioLoopActive = false
    cancelAnimationFrame(tickFrameId)
    tickFrameId = 0

    if (micStream?.getTracks) {
      for (const track of micStream.getTracks()) {
        track.stop()
      }
    }

    await audioContext.close()
    audioContext = undefined
    analyser = undefined
    micStream = undefined
    clippingFrames = 0
    totalAudioFrames = 0
    audioStatus.textContent = 'Аудио-анализатор: остановлен'
  }

  return { startMicrophone, stopMicrophone }
}
