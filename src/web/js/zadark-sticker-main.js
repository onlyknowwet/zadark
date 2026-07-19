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
  const logSendResponse = async (response, cipher) => {
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
          console.warn('[ZaDarkSticker] response diagnostic failed', error)
        }
      }
      console.debug('[ZaDarkSticker] send response (decrypted)', { status: response.status, body: responseBody })
    } catch (error) {
      console.warn('[ZaDarkSticker] response diagnostic failed', error)
    }
  }
  const send = async (input) => {
    try {
      if (!input || (input.mode !== 'direct' && input.mode !== 'group')) throw new Error('Sticker mode must be direct or group.')
      const endpoint = 'https://tt-files-wpa.chat.zalo.me/api/message/photo_url?zpw_ver=671&zpw_type=30&nretry=0'
      console.debug('[ZaDarkSticker] send endpoint', endpoint)
      if (typeof input.receiverId !== 'string' || !input.receiverId.trim()) throw new Error('Receiver ID is required.')
      const stickerUrl = new URL(String(input.stickerUrl || ''))
      if (stickerUrl.protocol !== 'https:') throw new Error('Sticker URL must use HTTPS.')
      input.receiverId = input.receiverId.trim()
      input.stickerUrl = stickerUrl.href
      input.width = 512
      input.height = 512
      const imei = localStorage.z_uuid
      if (!imei) throw new Error('Missing z_uuid. Sign in to chat.zalo.me and try again.')
      const login = await getJson(`https://wpa.chat.zalo.me/api/login/getLoginInfo?imei=${encodeURIComponent(imei)}`)
      const encryptionKey = login.data && login.data.zpw_enk
      if (!encryptionKey) throw new Error('Could not read zpw_enk from the Zalo Web session.')
      const cipher = await cipherFor(encryptionKey)
      let receiverId = input.receiverId
      if (input.mode === 'group') {
        const params = await cipher.encrypt({ globalUids: JSON.stringify([receiverId]) })
        const url = new URL('https://tt-profile-wpa.chat.zalo.me/api/gid/decrypt')
        url.search = new URLSearchParams({ zpw_ver: '669', zpw_type: '30', params })
        const encrypted = await getJson(url.href)
        if (!encrypted.data) throw new Error('Group decrypt API returned no encrypted data.')
        const group = JSON.parse(await cipher.decrypt(encrypted.data))
        receiverId = group.data && group.data.data && group.data.data[receiverId]
        if (!receiverId) throw new Error('Could not resolve the selected group conversation.')
      }
      const receiverKey = input.mode === 'direct' ? 'toId' : 'grid'
      const payload = {
        clientId: Date.now(),
        title: '',
        oriUrl: input.stickerUrl,
        thumbUrl: input.stickerUrl,
        hdUrl: input.stickerUrl,
        width: input.width,
        height: input.height,
        properties: JSON.stringify({ subType: 0, color: -1, size: -1, type: 3, ext: JSON.stringify({ sSrcStr: '', sSrcType: -1 }) }),
        contentId: '1337',
        thumb_height: input.height,
        thumb_width: input.width,
        webp: JSON.stringify({ width: input.width, height: input.height, url: input.stickerUrl }),
        jcp: JSON.stringify({ pStickerType: 1 }),
        zsource: -1,
        [receiverKey]: receiverId,
        ttl: 0
      }
      if (input.mode === 'group') payload.visibility = 0
      console.debug('[ZaDarkSticker] send request (decrypted)', payload)
      const params = await cipher.encrypt(payload)
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ params })
      })
      await logSendResponse(response, cipher)
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return { ok: true, message: 'Sticker sent.' }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      console.error('[ZaDarkSticker] send failed', error || message)
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
