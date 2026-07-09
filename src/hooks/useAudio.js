import { useRef } from 'react'

function getAudioLevelInfo(rms) {
  if (rms < 0.015) {
    return 'Слишком тихо'
  }
  if (rms > 0.12) {
    return 'Слишком шумно'
  }
  return 'Норма'
}

/**
 * Live-анализ микрофона: уровень шума и качество сигнала через Web Audio API.
 */
export function useAudio({ setHud, latestSignals, sessionStats }) {
  const state = useRef({
    audioContext: null,
    analyser: null,
    micStream: null,
    audioLoopActive: false,
    tickFrameId: 0,
    clippingFrames: 0,
    totalAudioFrames: 0,
  })

  async function startMicrophone() {
    const s = state.current
    if (s.audioContext) {
      return
    }

    s.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.audioContext = new AudioContext()
    const source = s.audioContext.createMediaStreamSource(s.micStream)
    s.analyser = s.audioContext.createAnalyser()
    s.analyser.fftSize = 2048
    source.connect(s.analyser)
    s.audioLoopActive = true

    const buffer = new Float32Array(s.analyser.fftSize)

    const tick = () => {
      if (!s.audioLoopActive) {
        return
      }

      s.analyser.getFloatTimeDomainData(buffer)
      let squareSum = 0
      let peak = 0

      for (const sample of buffer) {
        squareSum += sample * sample
        peak = Math.max(peak, Math.abs(sample))
      }

      const rms = Math.sqrt(squareSum / buffer.length)
      s.totalAudioFrames += 1
      if (peak > 0.97) {
        s.clippingFrames += 1
      }

      const clippingRate = s.totalAudioFrames === 0 ? 0 : s.clippingFrames / s.totalAudioFrames
      const noiseLevel = getAudioLevelInfo(rms)
      const quality =
        clippingRate > 0.12
          ? 'Обнаружен клиппинг. Уменьши усиление микрофона.'
          : rms < 0.01
            ? 'Сигнал слабый. Подойди ближе к микрофону.'
            : 'Качество микрофона в норме.'

      setHud('noise', `Шум: ${noiseLevel} (RMS ${rms.toFixed(3)})`, noiseLevel === 'Норма' ? 'good' : 'bad')
      setHud(
        'quality',
        `Качество микрофона: ${quality}`,
        quality === 'Качество микрофона в норме.' ? 'good' : 'bad',
      )

      const clippingRatePercent = Number((clippingRate * 100).toFixed(1))
      latestSignals.current.audio = {
        rms: Number(rms.toFixed(4)),
        noiseLevel,
        clippingRate: clippingRatePercent,
        quality,
      }

      sessionStats?.recordAudio({
        noiseLevel,
        qualityOk: quality === 'Качество микрофона в норме.',
        rms,
        clippingRate: clippingRatePercent,
      })

      s.tickFrameId = requestAnimationFrame(tick)
    }

    tick()
  }

  async function stopMicrophone() {
    const s = state.current
    if (!s.audioContext) {
      return
    }

    s.audioLoopActive = false
    cancelAnimationFrame(s.tickFrameId)
    s.tickFrameId = 0

    if (s.micStream?.getTracks) {
      for (const track of s.micStream.getTracks()) {
        track.stop()
      }
    }

    await s.audioContext.close()
    s.audioContext = null
    s.analyser = null
    s.micStream = null
    s.clippingFrames = 0
    s.totalAudioFrames = 0

    setHud('noise', 'Шум: данных пока нет.', 'neutral')
    setHud('quality', 'Качество микрофона: данных пока нет.', 'neutral')
  }

  return { startMicrophone, stopMicrophone }
}
