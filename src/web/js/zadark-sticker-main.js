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
  const getJson = async (url) => {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return response.json()
  }
  const parseJson = (value) => {
    try { return JSON.parse(value) } catch (_) { return value }
  }
  const logSendResponse = async (response, cipher, variant) => {
    let responseBody
    try {
      const responseText = await response.text()
      const responseEnvelope = parseJson(responseText)
      responseBody = responseEnvelope
      if (responseEnvelope && typeof responseEnvelope === 'object' && typeof responseEnvelope.data === 'string' && responseEnvelope.data) {
        try {
          responseBody = { ...responseEnvelope, data: parseJson(await cipher.decrypt(responseEnvelope.data)) }
        } catch (error) {
          responseBody = { ...responseEnvelope, data: '[decryption failed]' }
          console.warn('[ZaDarkSticker] response diagnostic failed', { variant, error })
        }
      }
      console.debug('[ZaDarkSticker] send response (decrypted)', { variant, status: response.status, body: responseBody })
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
      console.debug('[ZaDarkSticker] send request (decrypted)', { variant, payload })
      const params = await cipher.encrypt(payload)
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ params })
      })
      const responseBody = await logSendResponse(response, cipher, variant)
      const errorCode = findErrorCode(responseBody)
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      if (errorCode !== null && errorCode !== 0) throw new Error(`Zalo returned error_code ${errorCode}.`)
      return { variant, ok: true }
    } catch (error) {
      console.error('[ZaDarkSticker] send variant failed', { variant, error })
      throw error
    }
  }
  const resolveGroupReceiverId = async (receiverId, cipher) => {
    const params = await cipher.encrypt({ globalUids: JSON.stringify([receiverId]) })
    const url = new URL('https://tt-profile-wpa.chat.zalo.me/api/gid/decrypt')
    url.search = new URLSearchParams({ zpw_ver: '669', zpw_type: '30', params })
    const encrypted = await getJson(url.href)
    if (!encrypted.data) throw new Error('Group decrypt API returned no encrypted data.')
    const group = JSON.parse(await cipher.decrypt(encrypted.data))
    const resolvedId = group.data && group.data.data && group.data.data[receiverId]
    if (!resolvedId) throw new Error('Group mapping was not returned.')
    return resolvedId
  }
  const resolveGroupReceiverIdWithFallback = async (receiverId, cipher) => {
    let timer
    try {
      const resolvedId = await Promise.race([
        resolveGroupReceiverId(receiverId, cipher),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000) })
      ])
      if (!resolvedId) throw new Error('Group mapping timed out.')
      return resolvedId
    } catch (error) {
      console.warn('[ZaDarkSticker] group receiver resolution failed; using original conversation ID', {
        variant: 'group',
        message: error && error.message ? error.message : String(error)
      })
      return receiverId
    } finally {
      clearTimeout(timer)
    }
  }
  const send = async (input) => {
    try {
      if (!input || typeof input !== 'object') throw new Error('Sticker details are required.')
      const endpoint = 'https://tt-files-wpa.chat.zalo.me/api/message/photo_url?zpw_ver=671&zpw_type=30&nretry=0'
      console.debug('[ZaDarkSticker] send endpoint', { variant: 'direct', endpoint })
      console.debug('[ZaDarkSticker] send endpoint', { variant: 'group', endpoint })
      if (typeof input.receiverId !== 'string' || !input.receiverId.trim()) throw new Error('Receiver ID is required.')
      const stickerUrl = new URL(String(input.stickerUrl || ''))
      if (stickerUrl.protocol !== 'https:') throw new Error('Sticker URL must use HTTPS.')
      const receiverId = input.receiverId.trim()
      const normalizedStickerUrl = stickerUrl.href
      const width = 512
      const height = 512
      const imei = localStorage.z_uuid
      if (!imei) throw new Error('Missing z_uuid. Sign in to chat.zalo.me and try again.')
      const login = await getJson(`https://wpa.chat.zalo.me/api/login/getLoginInfo?imei=${encodeURIComponent(imei)}`)
      const encryptionKey = login.data && login.data.zpw_enk
      if (!encryptionKey) throw new Error('Could not read zpw_enk from the Zalo Web session.')
      const cipher = await cipherFor(encryptionKey)
      const clientId = Date.now()
      const basePayload = {
        title: '',
        oriUrl: normalizedStickerUrl,
        thumbUrl: normalizedStickerUrl,
        hdUrl: normalizedStickerUrl,
        width,
        height,
        properties: JSON.stringify({ subType: 0, color: -1, size: -1, type: 3, ext: JSON.stringify({ sSrcStr: '', sSrcType: -1 }) }),
        contentId: '1337',
        thumb_height: height,
        thumb_width: width,
        webp: JSON.stringify({ width, height, url: normalizedStickerUrl }),
        jcp: JSON.stringify({ pStickerType: 1 }),
        zsource: -1
      }
      const directPayload = { ...basePayload, clientId, toId: receiverId, ttl: 0 }
      const directAttempt = postVariant({ variant: 'direct', endpoint, payload: directPayload, cipher })
      const groupAttempt = resolveGroupReceiverIdWithFallback(receiverId, cipher).then((groupReceiverId) => {
        const groupPayload = { ...basePayload, clientId: clientId + 1, grid: groupReceiverId, ttl: 0, visibility: 0 }
        return postVariant({ variant: 'group', endpoint, payload: groupPayload, cipher })
      })
      const attempts = await Promise.allSettled([
        directAttempt,
        groupAttempt
      ])
      const successCount = attempts.filter((attempt) => attempt.status === 'fulfilled').length
      if (successCount === 2) return { ok: true, message: 'Both sticker variants succeeded.' }
      if (successCount === 1) return { ok: true, message: 'One sticker variant succeeded.' }
      const failureMessages = attempts.map((attempt) => attempt.reason && attempt.reason.message ? attempt.reason.message : String(attempt.reason))
      return { ok: false, message: `Both sticker variants failed. ${failureMessages.join(' ')}` }
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
    console.debug('[ZaDarkSticker] MAIN send request received', { id: request.id, payload: request.payload })
    const result = await send(request.payload || {})
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
