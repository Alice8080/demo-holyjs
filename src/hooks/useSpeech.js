import { useRef } from 'react'

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition
}

/**
 * Распознавание речи через Web Speech API.
 * onTranscript получает финальные куски текста, setAsrStatus — промежуточный статус.
 */
export function useSpeech({ onTranscript, setAsrStatus }) {
  const state = useRef({
    speechRecognition: null,
    recognitionActive: false,
  })

  function initSpeechRecognition() {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor()
    if (!SpeechRecognitionCtor) {
      setAsrStatus('Речь: API распознавания недоступно в этом браузере.')
      return null
    }

    if (state.current.speechRecognition) {
      return state.current.speechRecognition
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'ru-RU'

    recognition.onstart = () => {
      state.current.recognitionActive = true
      setAsrStatus('Речь: слушаю...')
    }

    recognition.onresult = (event) => {
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
        onTranscript(finalChunk.trim())
      }

      setAsrStatus(interimChunk ? `Речь: ${interimChunk.trim()}` : 'Речь: слушаю...')
    }

    recognition.onerror = (event) => {
      setAsrStatus(`Речь: ошибка (${event.error})`)
    }

    recognition.onend = () => {
      if (state.current.recognitionActive) {
        recognition.start()
        return
      }
      setAsrStatus('Речь: остановлено.')
    }

    state.current.speechRecognition = recognition
    return recognition
  }

  function startSpeechRecognition() {
    const recognition = initSpeechRecognition()
    if (!recognition) {
      return false
    }

    if (!state.current.recognitionActive) {
      state.current.recognitionActive = true
      recognition.start()
    }

    return true
  }

  function stopSpeechRecognition() {
    const s = state.current
    if (!s.speechRecognition || !s.recognitionActive) {
      return
    }

    s.recognitionActive = false
    s.speechRecognition.stop()
  }

  return { startSpeechRecognition, stopSpeechRecognition }
}
