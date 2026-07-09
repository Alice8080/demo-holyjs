function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition
}

export function createSpeechRecognitionController({
  transcriptText,
  asrStatus,
  onTranscriptFinalized,
}) {
  let speechRecognition
  let recognitionActive = false

  function initSpeechRecognition() {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor()
    if (!SpeechRecognitionCtor) {
      if (asrStatus) {
        asrStatus.textContent = 'Речь: API распознавания недоступно в этом браузере.'
      }
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
      if (asrStatus) {
        asrStatus.textContent = 'Речь: слушаю...'
      }
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
        onTranscriptFinalized()
      }

      if (asrStatus) {
        asrStatus.textContent = interimChunk
          ? `Речь: ${interimChunk.trim()}`
          : 'Речь: слушаю...'
      }
    }

    speechRecognition.onerror = (event) => {
      if (asrStatus) {
        asrStatus.textContent = `Речь: ошибка (${event.error})`
      }
    }

    speechRecognition.onend = () => {
      if (recognitionActive) {
        speechRecognition.start()
        return
      }
      if (asrStatus) {
        asrStatus.textContent = 'Речь: остановлено.'
      }
    }

    return speechRecognition
  }

  function startSpeechRecognition() {
    const recognition = initSpeechRecognition()
    if (!recognition) {
      return false
    }

    if (!recognitionActive) {
      recognitionActive = true
      recognition.start()
      return true
    }

    return true
  }

  function stopSpeechRecognition() {
    if (!speechRecognition || !recognitionActive) {
      return
    }

    recognitionActive = false
    speechRecognition.stop()
  }

  return { startSpeechRecognition, stopSpeechRecognition }
}
