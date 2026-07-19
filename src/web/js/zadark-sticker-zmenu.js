/* Isolated-world relay between the service worker and zmenu MAIN world. */
(function () {
  const UPLOAD_PROTOCOL = 'source-url-v2'
  const CAPABILITIES_ACTION = '@ZaDark:Sticker:UploadCapabilities'
  const resultError = (message) => ({ ok: false, message })
  const sourceTypeFor = (payload) => payload && payload.sourceType
    ? payload.sourceType
    : payload && typeof payload.sourceUrl === 'string' ? 'url' : 'file'
  const normalizeError = (error, fallback) => error && typeof error.message === 'string' && error.message
    ? error.message
    : typeof error === 'string' && error ? error : fallback
  const relayUpload = (request) => new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    let timer
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      document.removeEventListener('@ZaDark:Sticker:UploadResult', onResult)
      const normalized = result && typeof result.ok === 'boolean'
        ? result
        : resultError('The zmenu page returned a malformed upload result.')
      console.debug('[ZaDarkSticker] zmenu relay <- MAIN upload response', {
        id,
        ok: normalized.ok,
        message: normalized.message,
        photoUrl: normalized.photoUrl
      })
      resolve(normalized)
    }
    const onResult = (event) => {
      let response
      try { response = JSON.parse(event.detail) } catch (_) { return }
      if (response && response.id === id) finish(response.result)
    }
    document.addEventListener('@ZaDark:Sticker:UploadResult', onResult)
    timer = setTimeout(() => finish({ ok: false, message: 'Uploading timed out and completion is unknown. Check the sticker URL before retrying to avoid uploading twice.' }), 30000)
    const requestLog = {
      id,
      protocol: request.payload && request.payload.protocol,
      sourceType: sourceTypeFor(request.payload),
      fileName: request.payload && request.payload.fileName
    }
    if (requestLog.sourceType === 'url') requestLog.sourceUrl = request.payload && request.payload.sourceUrl
    console.debug('[ZaDarkSticker] zmenu relay -> MAIN upload request', requestLog)
    try {
      document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadRequest', { detail: JSON.stringify({ id, payload: request.payload }) }))
    } catch (error) {
      const message = normalizeError(error, 'Could not dispatch the upload request to the zmenu page.')
      console.error('[ZaDarkSticker] zmenu relay -> MAIN upload error', message)
      finish(resultError(message))
    }
  })

  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener((request) => {
      if (request && request.action === CAPABILITIES_ACTION) return Promise.resolve({ protocol: UPLOAD_PROTOCOL })
      if (!request || request.action !== '@ZaDark:Sticker:UploadInTab') return false
      return relayUpload(request).catch((error) => {
        const message = normalizeError(error, 'The zmenu upload relay failed.')
        console.error('[ZaDarkSticker] zmenu relay upload error', message)
        return resultError(message)
      })
    })
  } else {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === CAPABILITIES_ACTION) {
        sendResponse({ protocol: UPLOAD_PROTOCOL })
        return false
      }
      if (!request || request.action !== '@ZaDark:Sticker:UploadInTab') return false
      relayUpload(request).then(sendResponse).catch((error) => {
        const message = normalizeError(error, 'The zmenu upload relay failed.')
        console.error('[ZaDarkSticker] zmenu relay upload error', message)
        sendResponse(resultError(message))
      })
      return true
    })
  }
})()
