/* ZaDark sticker API (isolated content-script world). */
(function (global) {
  const REQUEST_EVENT = '@ZaDark:Sticker:Send'
  const RESPONSE_EVENT = '@ZaDark:Sticker:SendResult'
  const UPLOAD_ACTION = '@ZaDark:Sticker:Upload'
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
          done(resultError(normalizeError(error, 'Could not contact the extension service worker.').message))
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

  const getDetectedConversationId = () => {
    const detectedId = global.ZaDarkUtils && global.ZaDarkUtils.getCurrentConvId()
    return typeof detectedId === 'string' && detectedId.trim()
      ? detectedId.trim()
      : null
  }

  const isChatViewMounted = () => {
    const chatView = document.getElementById('chatViewContainer')
    if (!chatView || !chatView.isConnected || chatView.hidden || chatView.getAttribute('aria-hidden') === 'true') return false
    const style = global.getComputedStyle(chatView)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }

  const hasSelectedConversation = () => {
    const conversationList = document.getElementById('conversationListId')
    return !!(conversationList && conversationList.querySelector([
      '.msg-item.selected',
      '.msg-item.active',
      '.msg-item--selected',
      '.msg-item[aria-selected="true"]',
      '.conv-item.selected',
      '.selected',
      '[role="option"][aria-selected="true"]',
      '[aria-current="true"]',
      '[data-selected="true"]'
    ].join(',')))
  }

  const logConversationState = (source) => {
    console.debug('[ZaDarkSticker] conversation state', { conversationId: currentConversationId, source })
  }

  const syncCurrentConversation = () => {
    const detectedId = getDetectedConversationId()
    if (detectedId) {
      currentConversationId = detectedId
      logConversationState('detected')
    } else if (isChatViewMounted() || hasSelectedConversation()) {
      logConversationState('retained')
    } else {
      currentConversationId = null
      logConversationState('cleared')
    }
    return currentConversationId
  }

  const getConversationIdForSend = () => {
    const detectedId = getDetectedConversationId()
    if (detectedId) {
      currentConversationId = detectedId
      logConversationState('detected')
      return currentConversationId
    }

    if (currentConversationId && isChatViewMounted()) {
      logConversationState('retained')
      return currentConversationId
    }

    currentConversationId = null
    logConversationState('cleared')
    return null
  }

  document.addEventListener('@ZaDark:CONV_ID_CHANGE', syncCurrentConversation)
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
        const result = await runtimeMessage({ action: UPLOAD_ACTION, payload: { dataUrl, fileName: file.name } })
        return result && typeof result.ok === 'boolean' ? result : resultError('The extension returned a malformed upload result.')
      } catch (error) { return resultError(normalizeError(error, 'Sticker upload failed.').message) }
    },
    send: async (input) => {
      try {
        if (!input || (input.mode !== 'direct' && input.mode !== 'group')) throw new Error('Sticker mode must be direct or group.')
        const receiverId = getConversationIdForSend()
        if (!receiverId || !receiverId.trim()) throw new Error('Select a Zalo conversation before sending a sticker.')
        const url = new URL(String(input.stickerUrl || '').trim())
        if (url.protocol !== 'https:') throw new Error('Sticker URL must use HTTPS.')
        return requestMain({ receiverId: receiverId.trim(), stickerUrl: url.href, mode: input.mode, width: 512, height: 512 })
      } catch (error) { return resultError(normalizeError(error, 'Sticker send failed.').message) }
    }
  }

  const handleSendInTab = (request) => {
    if (!request || request.action !== '@ZaDark:Sticker:SendInTab') return null
    const payload = request.payload
    const mode = payload && typeof payload === 'object' ? payload.mode : undefined
    console.debug('[ZaDarkSticker] chat listener received', { action: request.action, mode })
    if (!payload || typeof payload !== 'object') {
      console.error('[ZaDarkSticker] chat listener error: The popup supplied malformed sticker details.')
      return Promise.resolve(resultError('The popup supplied malformed sticker details.'))
    }
    return Promise.resolve().then(() => global.ZaDarkSticker.send(payload)).then((result) => {
      const normalized = result && typeof result.ok === 'boolean' && typeof result.message === 'string'
        ? result
        : resultError('The chat sticker sender returned a malformed result.')
      console.debug('[ZaDarkSticker] chat listener result', { action: request.action, mode: payload.mode, ok: normalized.ok })
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
