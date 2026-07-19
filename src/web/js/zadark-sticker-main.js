/* ZaDark sticker sender (chat.zalo.me MAIN world). */
(function () {
  const REQUEST_EVENT = '@ZaDark:Sticker:Send'
  const RESPONSE_EVENT = '@ZaDark:Sticker:SendResult'
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  const toBase64 = (value) => {
    let binary = ''
    new Uint8Array(value).forEach((byte) => { binary += String.fromCharCode(byte) })
    return btoa(binary)
  }
  const cipherFor = async (base64Key) => {
    const key = await crypto.subtle.importKey('raw', fromBase64(base64Key), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'])
    const iv = new Uint8Array(16)
    return {
      encrypt: async (value) => toBase64(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoder.encode(JSON.stringify(value)))),
      decrypt: async (value) => decoder.decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, fromBase64(value)))
    }
  }
  const parseJson = (value) => {
    try { return JSON.parse(value) } catch (_) { return value }
  }
  const responseForLog = (step, value) => {
    if (step !== 'login-info' || !value || typeof value !== 'object' || !value.data || typeof value.data !== 'object') return value
    return { ...value, data: { ...value.data, zpw_enk: value.data.zpw_enk ? '[redacted]' : value.data.zpw_enk } }
  }
  const getJson = async (step, url) => {
    console.log('[ZaDarkSticker] Zalo request', {
      step,
      method: 'GET',
      url,
      credentials: 'include',
      body: null
    })
    const response = await fetch(url, { credentials: 'include' })
    const responseText = await response.text()
    const responseBody = parseJson(responseText)
    console.log('[ZaDarkSticker] Zalo response', {
      step,
      status: response.status,
      ok: response.ok,
      body: responseForLog(step, responseBody)
    })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return responseBody
  }
  const logSendResponse = async (response, cipher, variant) => {
    let responseBody
    try {
      const responseText = await response.text()
      const responseEnvelope = parseJson(responseText)
      console.log('[ZaDarkSticker] Zalo response', {
        step: `photo-url:${variant}`,
        status: response.status,
        ok: response.ok,
        body: responseEnvelope
      })
      responseBody = responseEnvelope
      if (responseEnvelope && typeof responseEnvelope === 'object' && typeof responseEnvelope.data === 'string' && responseEnvelope.data) {
        try {
          responseBody = { ...responseEnvelope, data: parseJson(await cipher.decrypt(responseEnvelope.data)) }
        } catch (error) {
          responseBody = { ...responseEnvelope, data: '[decryption failed]' }
          console.warn('[ZaDarkSticker] response diagnostic failed', { variant, error })
        }
      }
      console.log('[ZaDarkSticker] Zalo response (decrypted)', {
        step: `photo-url:${variant}`,
        status: response.status,
        ok: response.ok,
        body: responseBody
      })
    } catch (error) {
      console.warn('[ZaDarkSticker] response diagnostic failed', { variant, error })
    }
    return responseBody
  }
  const findErrorCode = (value, remaining = 20) => {
    if (!value || typeof value !== 'object' || remaining <= 0) return null
    let foundCode = typeof value.error_code === 'number' ? value.error_code : null
    if (foundCode !== null && foundCode !== 0) return foundCode
    for (const key of Object.keys(value)) {
      const errorCode = findErrorCode(value[key], remaining - 1)
      if (errorCode !== null && errorCode !== 0) return errorCode
      if (errorCode === 0) foundCode = 0
    }
    return foundCode
  }
  const postVariant = async ({ variant, endpoint, payload, cipher }) => {
    try {
      const params = await cipher.encrypt(payload)
      console.log('[ZaDarkSticker] Zalo request', {
        step: `photo-url:${variant}`,
        method: 'POST',
        url: endpoint,
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: { params },
        decryptedBody: payload
      })
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ params })
      })
      const responseBody = await logSendResponse(response, cipher, variant)
      const errorCode = findErrorCode(responseBody)
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      if (errorCode !== null && errorCode !== 0) throw new Error(`Zalo returned error_code ${errorCode}.`)
      return { variant, ok: true }
    } catch (error) {
      console.error('[ZaDarkSticker] send variant failed', {
        variant,
        message: error && error.message ? error.message : String(error),
        error
      })
      throw error
    }
  }
  const send = async (input) => {
    try {
      if (!input || typeof input !== 'object') throw new Error('Sticker details are required.')
      const directEndpoint = 'https://tt-files-wpa.chat.zalo.me/api/message/photo_url?zpw_ver=671&zpw_type=30&nretry=0'
      const groupEndpoint = 'https://tt-files-wpa.chat.zalo.me/api/group/photo_url?zpw_ver=688&zpw_type=30&nretry=0'
      if (typeof input.receiverId !== 'string' || !input.receiverId.trim()) throw new Error('Receiver ID is required.')
      const stickerUrl = new URL(String(input.stickerUrl || ''))
      if (stickerUrl.protocol !== 'https:') throw new Error('Sticker URL must use HTTPS.')
      const receiverId = input.receiverId.trim()
      const normalizedStickerUrl = stickerUrl.href
      const thumbUrlInput = String(input.thumbUrl || '').trim()
      const thumbUrl = thumbUrlInput ? new URL(thumbUrlInput) : stickerUrl
      if (thumbUrl.protocol !== 'https:') throw new Error('Sticker thumbnail URL must use HTTPS.')
      const normalizedThumbUrl = thumbUrl.href
      const width = 512
      const height = 512
      const imei = localStorage.z_uuid
      if (!imei) throw new Error('Missing z_uuid. Sign in to chat.zalo.me and try again.')
      const login = await getJson('login-info', `https://wpa.chat.zalo.me/api/login/getLoginInfo?imei=${encodeURIComponent(imei)}`)
      const encryptionKey = login.data && login.data.zpw_enk
      if (!encryptionKey) throw new Error('Could not read zpw_enk from the Zalo Web session.')
      const cipher = await cipherFor(encryptionKey)
      const clientId = Date.now()
      const basePayload = {
        title: '',
        oriUrl: normalizedStickerUrl,
        thumbUrl: normalizedThumbUrl,
        hdUrl: normalizedStickerUrl,
        width,
        height,
        properties: JSON.stringify({ subType: 0, color: -1, size: -1, type: 3, ext: JSON.stringify({ sSrcStr: '', sSrcType: -1 }) }),
        contentId: '1337',
        thumb_height: height,
        thumb_width: width,
        webp: JSON.stringify({ width, height, url: normalizedStickerUrl }),
        // pStickerType: 1 marks the sticker as AI-generated.
        // jcp: JSON.stringify({ pStickerType: 1 }),
        jcp: JSON.stringify({ pStickerType: 0 }),
        zsource: -1
      }
      const isGroup = receiverId.startsWith('g')
      const variant = isGroup ? 'group' : 'direct'
      const endpoint = isGroup ? groupEndpoint : directEndpoint
      const payload = isGroup
        ? { ...basePayload, clientId, grid: receiverId.slice(1), ttl: 0, visibility: 0 }
        : { ...basePayload, clientId, toId: receiverId, ttl: 0 }
      console.debug('[ZaDarkSticker] send endpoint', { variant, endpoint })
      await postVariant({ variant, endpoint, payload, cipher })
      return { ok: true, message: `${variant === 'group' ? 'Group' : 'Direct'} sticker succeeded.` }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      console.error('[ZaDarkSticker] send failed', { variant: 'overall', error: error || message })
      return { ok: false, message }
    }
  }
  document.addEventListener(REQUEST_EVENT, async (event) => {
    let request
    try {
      request = JSON.parse(event.detail)
    } catch (error) {
      console.error('[ZaDarkSticker] MAIN send request contains invalid JSON', error)
      return
    }
    if (!request || typeof request.id !== 'string') {
      console.error('[ZaDarkSticker] MAIN send request is missing a valid id')
      return
    }
    console.log('[ZaDarkSticker] MAIN send request received', { id: request.id, body: request.payload })
    const result = await send(request.payload || {})
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
