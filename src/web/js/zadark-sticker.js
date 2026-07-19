/* ZaDark sticker API (isolated content-script world). */
(function (global) {
  const REQUEST_EVENT = '@ZaDark:Sticker:Send'
  const RESPONSE_EVENT = '@ZaDark:Sticker:SendResult'
  const UPLOAD_ACTION = '@ZaDark:Sticker:Upload'
  const UPLOAD_PROTOCOL = 'source-url-v2'
  const TIMEOUT = 30000
  let currentConversationId = null

  const resultError = (message) => ({ ok: false, message })
  const normalizeError = (error, fallback = 'Unexpected sticker failure.') => {
    if (error instanceof Error) return error
    if (typeof error === 'string' && error) return new Error(error)
    if (error && typeof error.message === 'string' && error.message) return new Error(error.message)
    return new Error(fallback)
  }

  const requestMain = (payload) => new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    let timer
    const onResult = (event) => {
      let response
      try { response = JSON.parse(event.detail) } catch (_) { return }
      if (!response || response.id !== id) return
      clearTimeout(timer)
      document.removeEventListener(RESPONSE_EVENT, onResult)
      const result = response.result && typeof response.result.ok === 'boolean'
        ? response.result
        : resultError('Zalo returned a malformed sticker result.')
      console.debug('[ZaDarkSticker] MAIN send result received', { id, ok: result.ok, message: result.message })
      resolve(result)
    }
    document.addEventListener(RESPONSE_EVENT, onResult)
    timer = setTimeout(() => {
      document.removeEventListener(RESPONSE_EVENT, onResult)
      console.error('[ZaDarkSticker] MAIN send request timed out', { id })
      resolve(resultError('Sending timed out and completion is unknown. Check the conversation before retrying to avoid sending the sticker twice.'))
    }, TIMEOUT)
    console.debug('[ZaDarkSticker] dispatching MAIN send request', {
      id,
      receiverId: payload.receiverId,
      stickerUrl: payload.stickerUrl
    })
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
          const normalized = normalizeError(error, 'Could not contact the extension service worker.')
          console.error('[ZaDarkSticker] chat upload background error', normalized.message)
          done(resultError(normalized.message))
        })
      } else {
        chrome.runtime.sendMessage(message, (result) => {
          const error = chrome.runtime.lastError
          done(error ? resultError(normalizeError(error, 'Could not contact the extension service worker.').message) : result)
        })
      }
    } catch (error) {
      done(resultError(normalizeError(error).message))
    }
  })

  const uploadMessage = async (payload, sourceType) => {
    const requestLog = { protocol: UPLOAD_PROTOCOL, sourceType, fileName: payload.fileName }
    if (sourceType === 'url') requestLog.sourceUrl = payload.sourceUrl
    console.debug('[ZaDarkSticker] chat -> background upload request', requestLog)
    try {
      const result = await runtimeMessage({ action: UPLOAD_ACTION, payload })
      const normalized = result && typeof result.ok === 'boolean'
        ? result
        : resultError('The extension returned a malformed upload result.')
      console.debug('[ZaDarkSticker] chat <- background upload response', {
        protocol: UPLOAD_PROTOCOL,
        sourceType,
        ok: normalized.ok,
        message: normalized.message,
        photoUrl: normalized.photoUrl,
        uploadResponse: normalized.uploadResponse
      })
      return normalized
    } catch (error) {
      const normalized = normalizeError(error, 'Sticker upload messaging failed.')
      console.error('[ZaDarkSticker] chat <- background upload response', normalized.message)
      return resultError(normalized.message)
    }
  }

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

  const fileNameFromUrl = (url) => {
    let fileName = ''
    try { fileName = decodeURIComponent(url.pathname).split('/').pop() } catch (_) { fileName = url.pathname.split('/').pop() }
    return (fileName || 'sticker').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'sticker'
  }

  const getDetectedConversationId = () => {
    const detectedId = global.ZaDarkUtils && global.ZaDarkUtils.getCurrentConvId()
    return typeof detectedId === 'string' && detectedId.trim()
      ? detectedId.trim()
      : null
  }

  const logConversationState = (source) => {
    console.debug('[ZaDarkSticker] conversation state', { conversationId: currentConversationId, source })
  }

  const syncCurrentConversation = () => {
    const detectedId = getDetectedConversationId()
    if (detectedId) {
      currentConversationId = detectedId
      logConversationState('detected')
    } else if (currentConversationId) {
      logConversationState('retained')
    } else {
      logConversationState('uninitialized')
    }
    return currentConversationId
  }

  const handleConversationChange = (event) => {
    const eventConversationId = typeof event.detail === 'string' && event.detail.trim()
      ? event.detail.trim()
      : null
    if (eventConversationId) {
      currentConversationId = eventConversationId
      logConversationState('event')
      return
    }

    syncCurrentConversation()
  }

  const getConversationIdForSend = () => {
    const detectedId = getDetectedConversationId()
    if (detectedId) {
      currentConversationId = detectedId
      logConversationState('detected')
      return currentConversationId
    }

    if (currentConversationId) {
      logConversationState('retained')
      return currentConversationId
    }

    logConversationState('uninitialized')
    return null
  }

  document.addEventListener('@ZaDark:CONV_ID_CHANGE', handleConversationChange)
  const conversationObserver = new MutationObserver(syncCurrentConversation)
  conversationObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-current-conv-id']
  })
  syncCurrentConversation()

  global.ZaDarkSticker = {
    upload: async (file) => {
      try {
        const dataUrl = await readFile(file)
        console.debug('[ZaDarkSticker] upload dispatch', { protocol: UPLOAD_PROTOCOL, sourceType: 'file' })
        return uploadMessage({ protocol: UPLOAD_PROTOCOL, dataUrl, fileName: file.name }, 'file')
      } catch (error) { return resultError(normalizeError(error, 'Sticker upload failed.').message) }
    },
    uploadUrl: async (sourceUrl) => {
      try {
        const url = new URL(String(sourceUrl || '').trim())
        if (url.protocol !== 'https:') throw new Error('Sticker source URL must use HTTPS.')
        console.debug('[ZaDarkSticker] upload dispatch', { protocol: UPLOAD_PROTOCOL, sourceType: 'url' })
        return uploadMessage({ protocol: UPLOAD_PROTOCOL, sourceUrl: url.href, fileName: fileNameFromUrl(url) }, 'url')
      } catch (error) { return resultError(normalizeError(error, 'Sticker URL upload failed.').message) }
    },
    send: async (input) => {
      try {
        if (!input || typeof input !== 'object') throw new Error('Sticker details are required.')
        const receiverId = getConversationIdForSend()
        if (!receiverId || !receiverId.trim()) throw new Error('Select a Zalo conversation before sending a sticker.')
        const url = new URL(String(input.stickerUrl || '').trim())
        if (url.protocol !== 'https:') throw new Error('Sticker URL must use HTTPS.')
        return requestMain({ receiverId: receiverId.trim(), stickerUrl: url.href, width: 512, height: 512 })
      } catch (error) { return resultError(normalizeError(error, 'Sticker send failed.').message) }
    }
  }

  const handleSendInTab = (request) => {
    if (!request || request.action !== '@ZaDark:Sticker:SendInTab') return null
    const payload = request.payload
    console.debug('[ZaDarkSticker] chat listener received', { action: request.action })
    if (!payload || typeof payload !== 'object') {
      console.error('[ZaDarkSticker] chat listener error: The popup supplied malformed sticker details.')
      return Promise.resolve(resultError('The popup supplied malformed sticker details.'))
    }
    return Promise.resolve().then(() => global.ZaDarkSticker.send(payload)).then((result) => {
      const normalized = result && typeof result.ok === 'boolean' && typeof result.message === 'string'
        ? result
        : resultError('The chat sticker sender returned a malformed result.')
      console.debug('[ZaDarkSticker] chat listener result', { action: request.action, ok: normalized.ok })
      if (!normalized.ok) console.error('[ZaDarkSticker] chat listener error:', normalized.message)
      return normalized
    }, (error) => {
      const normalized = resultError(normalizeError(error, 'Chat sticker listener failed.').message)
      console.error('[ZaDarkSticker] chat listener error:', normalized.message)
      return normalized
    })
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
