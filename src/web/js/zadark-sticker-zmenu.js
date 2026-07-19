/* Isolated-world relay between the service worker and zmenu MAIN world. */
(function () {
  const resultError = (message) => ({ ok: false, message })
  const relayUpload = (request) => new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    let timer
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      document.removeEventListener('@ZaDark:Sticker:UploadResult', onResult)
      resolve(result && typeof result.ok === 'boolean'
        ? result
        : resultError('The zmenu page returned a malformed upload result.'))
    }
    const onResult = (event) => {
      let response
      try { response = JSON.parse(event.detail) } catch (_) { return }
      if (response && response.id === id) finish(response.result)
    }
    document.addEventListener('@ZaDark:Sticker:UploadResult', onResult)
    timer = setTimeout(() => finish({ ok: false, message: 'Uploading timed out and completion is unknown. Check the sticker URL before retrying to avoid uploading twice.' }), 30000)
    document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadRequest', { detail: JSON.stringify({ id, payload: request.payload }) }))
  })

  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener((request) => {
      if (!request || request.action !== '@ZaDark:Sticker:UploadInTab') return false
      return relayUpload(request)
    })
  } else {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (!request || request.action !== '@ZaDark:Sticker:UploadInTab') return false
      relayUpload(request).then(sendResponse)
      return true
    })
  }
})()
