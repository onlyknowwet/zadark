/* ZaDark sticker API (isolated content-script world). */
(function (global) {
  const REQUEST_EVENT = '@ZaDark:Sticker:Send'
  const RESPONSE_EVENT = '@ZaDark:Sticker:SendResult'
  const UPLOAD_ACTION = '@ZaDark:Sticker:Upload'
  const TIMEOUT = 30000

  const resultError = (message) => ({ ok: false, message })

  const requestMain = (payload) => new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    let timer
    const onResult = (event) => {
      let response
      try { response = JSON.parse(event.detail) } catch (_) { return }
      if (!response || response.id !== id) return
      clearTimeout(timer)
      document.removeEventListener(RESPONSE_EVENT, onResult)
      resolve(response.result && typeof response.result.ok === 'boolean'
        ? response.result
        : resultError('Zalo returned a malformed sticker result.'))
    }
    document.addEventListener(RESPONSE_EVENT, onResult)
    timer = setTimeout(() => {
      document.removeEventListener(RESPONSE_EVENT, onResult)
      resolve(resultError('Sending timed out and completion is unknown. Check the conversation before retrying to avoid sending the sticker twice.'))
    }, TIMEOUT)
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: JSON.stringify({ id, payload })
    }))
  })

  const runtimeMessage = (message) => new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (!settled) { settled = true; resolve(value) }
    }
    try {
      if (typeof browser !== 'undefined') {
        browser.runtime.sendMessage(message).then(done, (error) => {
          done(resultError((error && error.message) || 'Could not contact the extension service worker.'))
        })
      } else {
        chrome.runtime.sendMessage(message, (result) => {
          const error = chrome.runtime.lastError
          done(error ? resultError(error.message) : result)
        })
      }
    } catch (error) {
      done(resultError(error.message))
    }
  })

  const readFile = (file) => new Promise((resolve, reject) => {
    if (!(file instanceof File) || !file.size) return reject(new Error('Choose a non-empty sticker file to upload.'))
    if (!file.name || !file.name.trim()) return reject(new Error('The sticker file must have a valid name.'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the sticker file.'))
    reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:')
      ? resolve(reader.result)
      : reject(new Error('Could not encode the sticker file.'))
    reader.readAsDataURL(file)
  })

  global.ZaDarkSticker = {
    upload: async (file) => {
      try {
        const dataUrl = await readFile(file)
        const result = await runtimeMessage({ action: UPLOAD_ACTION, payload: { dataUrl, fileName: file.name } })
        return result && typeof result.ok === 'boolean' ? result : resultError('The extension returned a malformed upload result.')
      } catch (error) { return resultError(error.message || String(error)) }
    },
    send: async (input) => {
      try {
        if (!input || (input.mode !== 'direct' && input.mode !== 'group')) throw new Error('Sticker mode must be direct or group.')
        const receiverId = global.ZaDarkUtils && global.ZaDarkUtils.getCurrentConvId()
        if (!receiverId || !receiverId.trim()) throw new Error('Select a Zalo conversation before sending a sticker.')
        const url = new URL(String(input.stickerUrl || '').trim())
        if (url.protocol !== 'https:') throw new Error('Sticker URL must use HTTPS.')
        return requestMain({ receiverId: receiverId.trim(), stickerUrl: url.href, mode: input.mode, width: 512, height: 512 })
      } catch (error) { return resultError(error.message || String(error)) }
    }
  }

  const handleSendInTab = (request) => {
    if (!request || request.action !== '@ZaDark:Sticker:SendInTab') return null
    const payload = request.payload
    if (!payload || typeof payload !== 'object') return Promise.resolve(resultError('The popup supplied malformed sticker details.'))
    return global.ZaDarkSticker.send(payload)
  }

  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener((request) => {
      const result = handleSendInTab(request)
      if (result) return result
    })
  } else {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      const result = handleSendInTab(request)
      if (!result) return false
      result.then(sendResponse)
      return true
    })
  }
})(window)
