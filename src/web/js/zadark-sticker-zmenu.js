/* Isolated-world relay between the service worker and zmenu MAIN world. */
(function () {
  const UPLOAD_PROTOCOL = 'source-url-v2'
  const CAPABILITIES_ACTION = '@ZaDark:Sticker:UploadCapabilities'
  const resultError = (message) => ({ ok: false, message })
  const sourceTypeFor = (payload) => payload && typeof payload.sourceUrl === 'string' ? 'url' : 'file'
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
      console.debug('[ZaDarkSticker] zmenu relay result', { id, ok: normalized.ok, message: normalized.message })
      resolve(normalized)
    }
    const onResult = (event) => {
      let response
      try { response = JSON.parse(event.detail) } catch (_) { return }
      if (response && response.id === id) finish(response.result)
    }
    document.addEventListener('@ZaDark:Sticker:UploadResult', onResult)
    timer = setTimeout(() => finish({ ok: false, message: 'Uploading timed out and completion is unknown. Check the sticker URL before retrying to avoid uploading twice.' }), 30000)
    console.debug('[ZaDarkSticker] zmenu relay request', {
      id,
      protocol: request.payload && request.payload.protocol,
      sourceType: sourceTypeFor(request.payload)
    })
    document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadRequest', { detail: JSON.stringify({ id, payload: request.payload }) }))
  })

  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener((request) => {
      if (request && request.action === CAPABILITIES_ACTION) return Promise.resolve({ protocol: UPLOAD_PROTOCOL })
      if (!request || request.action !== '@ZaDark:Sticker:UploadInTab') return false
      return relayUpload(request)
    })
  } else {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === CAPABILITIES_ACTION) {
        sendResponse({ protocol: UPLOAD_PROTOCOL })
        return false
      }
      if (!request || request.action !== '@ZaDark:Sticker:UploadInTab') return false
      relayUpload(request).then(sendResponse)
      return true
    })
  }
})()
