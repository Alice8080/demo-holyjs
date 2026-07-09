function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition
}

export function createSpeechRecognitionController({
  transcriptText,
  asrStatus,
  toggleAsrBtn,
  onTranscriptFinalized,
}) {
  let speechRecognition
  let recognitionActive = false

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
        onTranscriptFinalized()
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

  return { toggleSpeechRecognition }
}
