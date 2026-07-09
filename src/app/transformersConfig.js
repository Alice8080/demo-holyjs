export const SENTIMENT_MODELS = [
  'onnx-community/rubert-tiny-sentiment-balanced-ONNX',
  'Xenova/bert-base-multilingual-uncased-sentiment',
]

export function configureTransformersEnv(env) {
  // In Vite SPA, unresolved local model paths return index.html.
  // Force Transformers.js to use remote model loading from Hugging Face Hub.
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true
  env.remoteHost = 'https://huggingface.co/'
}
