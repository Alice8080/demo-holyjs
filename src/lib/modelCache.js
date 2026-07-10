const DB_NAME = 'local-presentation-coach'
const DB_VERSION = 1
const STORE_NAME = 'vision-models'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'))
  })
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error ?? new Error(`Не удалось прочитать кэш: ${key}`))
  })
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`Не удалось сохранить кэш: ${key}`))
  })
}

async function readCachedModel(url) {
  const db = await openDb()
  try {
    const cached = await idbGet(db, url)
    if (!(cached instanceof ArrayBuffer)) {
      return null
    }
    return new Uint8Array(cached)
  } finally {
    db.close()
  }
}

async function writeCachedModel(url, buffer) {
  const db = await openDb()
  try {
    await idbPut(db, url, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
  } finally {
    db.close()
  }
}

/**
 * Возвращает буфер модели из IndexedDB или скачивает и кэширует его.
 */
export async function getModelBuffer(url) {
  const cached = await readCachedModel(url)
  if (cached) {
    return { buffer: cached, fromCache: true }
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Не удалось загрузить модель (${response.status}): ${url}`)
  }

  const buffer = new Uint8Array(await response.arrayBuffer())
  await writeCachedModel(url, buffer)
  return { buffer, fromCache: false }
}

/**
 * Параллельно загружает несколько моделей, используя кэш где возможно.
 */
export async function getModelBuffers(urls) {
  const entries = await Promise.all(urls.map(async (url) => [url, await getModelBuffer(url)]))
  const buffers = {}
  let fromCacheCount = 0

  for (const [url, result] of entries) {
    buffers[url] = result.buffer
    if (result.fromCache) {
      fromCacheCount += 1
    }
  }

  return {
    buffers,
    fromCacheCount,
    totalCount: urls.length,
  }
}
