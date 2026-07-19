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
  const send = async (input) => {
    try {
      if (!input || (input.mode !== 'direct' && input.mode !== 'group')) throw new Error('Sticker mode must be direct or group.')
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
      const referenceId = 'deadbeef'
      const receiverKey = input.mode === 'direct' ? 'toid' : 'grid'
      const payload = {
        [receiverKey]: receiverId, imei, visibility: 0, ttl: 0, zsource: -1, msgType: 2, clientId: Date.now(),
        msgInfo: JSON.stringify({
          title: '', description: '', childnumber: 0, action: '', type: '', thumbUrl: input.stickerUrl,
          oriUrl: input.stickerUrl, normalUrl: input.stickerUrl, contentId: '1337', thumb_width: input.width,
          thumb_height: input.height, webp: JSON.stringify({ width: input.width, url: input.stickerUrl, height: input.height }),
          width: input.width, height: input.height,
          properties: JSON.stringify({ color: -1, size: -1, type: 3, subType: 0, ext: JSON.stringify({ shouldParseLinkOrContact: 0 }) }),
          photoId: 1,
          reference: JSON.stringify({ type: 3, data: JSON.stringify({ id: referenceId, logSrcType: 1, ts: 1, fwLvl: 12, rootMsgRef: { id: referenceId, ts: 1, logSrcType: 1 } }) })
        }),
        decorLog: JSON.stringify({ fw: { pmsg: { st: 1, ts: 1, id: referenceId }, rmsg: { st: 1, ts: 1, id: referenceId }, fwLvl: 12 } })
      }
      const params = await cipher.encrypt(payload)
      const path = input.mode === 'direct' ? '/api/message/forward' : '/api/group/forward'
      const response = await fetch(`https://tt-files-wpa.chat.zalo.me${path}?zpw_ver=671&zpw_type=30&nretry=0`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ params })
      })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return { ok: true, message: 'Sticker sent.' }
    } catch (error) { return { ok: false, message: error.message || String(error) } }
  }
  document.addEventListener(REQUEST_EVENT, async (event) => {
    let request
    try { request = JSON.parse(event.detail) } catch (_) { return }
    if (!request || typeof request.id !== 'string') return
    const result = await send(request.payload || {})
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
