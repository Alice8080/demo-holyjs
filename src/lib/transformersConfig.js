export const SENTIMENT_MODELS = [
  'onnx-community/rubert-tiny-sentiment-balanced-ONNX',
  'Xenova/bert-base-multilingual-uncased-sentiment',
]

export function configureTransformersEnv(env) {
  // В Vite SPA неразрешённые локальные пути к модели возвращают index.html.
  // Заставляем Transformers.js грузить модели с Hugging Face Hub.
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true
  env.remoteHost = 'https://huggingface.co/'
}
