/* zmenu.zalo.me MAIN-world upload bridge. */
(function () {
  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024
  const MIME_EXTENSIONS = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp'
  }

  const safeFileName = (value, mimeType) => {
    let fileName = typeof value === 'string' ? value.trim().split(/[\\/]/).pop() : ''
    fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'sticker'
    const extension = MIME_EXTENSIONS[mimeType.toLowerCase()]
    if (extension && !/\.[a-zA-Z0-9]{1,8}$/.test(fileName)) fileName += `.${extension}`
    return fileName
  }

  const getSourceFileName = (sourceUrl, suppliedName, mimeType) => {
    let pathName = ''
    try { pathName = decodeURIComponent(sourceUrl.pathname) } catch (_) { pathName = sourceUrl.pathname }
    return safeFileName(suppliedName || pathName, mimeType)
  }

  const downloadSourceImage = async (sourceUrl) => {
    let response
    try {
      response = await fetch(sourceUrl.href, { credentials: 'omit' })
    } catch (_) {
      throw new Error('The source image could not be downloaded by zmenu. The image host may block cross-origin requests.')
    }
    if (!response.ok) throw new Error(`The source image could not be downloaded by zmenu: HTTP ${response.status}.`)
    const contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
    if (!contentType.startsWith('image/')) throw new Error('The source URL did not return an image Content-Type.')
    try {
      return { blob: await response.blob(), contentType }
    } catch (_) {
      throw new Error('The source image could not be downloaded by zmenu. The image host may block cross-origin requests.')
    }
  }

  document.addEventListener('@ZaDark:Sticker:UploadRequest', async (event) => {
    let request
    try { request = JSON.parse(event.detail) } catch (_) { return }
    if (!request || typeof request.id !== 'string') return
    let result
    try {
      const payload = request.payload || {}
      const hasDataUrl = Object.prototype.hasOwnProperty.call(payload, 'dataUrl')
      const hasSourceUrl = Object.prototype.hasOwnProperty.call(payload, 'sourceUrl')
      if (hasDataUrl === hasSourceUrl) throw new Error('Provide exactly one sticker file or source URL.')
      const auth = JSON.parse(localStorage.getItem('zalo.auth_data') || '{}')
      if (!auth.access_token) throw new Error('No authenticated zmenu session. Open zmenu.zalo.me and sign in first.')
      let blob
      let fileName
      if (hasSourceUrl) {
        if (typeof payload.sourceUrl !== 'string' || !payload.sourceUrl.trim()) throw new Error('Malformed sticker source URL.')
        const sourceUrl = new URL(payload.sourceUrl.trim())
        if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname) throw new Error('The source image URL must use HTTPS.')
        const downloaded = await downloadSourceImage(sourceUrl)
        blob = downloaded.blob
        fileName = getSourceFileName(sourceUrl, payload.fileName, downloaded.contentType)
      } else {
        if (typeof payload.dataUrl !== 'string' || !payload.dataUrl.startsWith('data:') || typeof payload.fileName !== 'string' || !payload.fileName.trim()) throw new Error('Malformed sticker file data.')
        const blobResponse = await fetch(payload.dataUrl)
        blob = await blobResponse.blob()
        fileName = safeFileName(payload.fileName, blob.type || '')
      }
      if (!blob.size) throw new Error('The sticker file is empty.')
      if (!blob.type || !blob.type.startsWith('image/')) throw new Error('The sticker file must be an image.')
      if (blob.size > MAX_UPLOAD_SIZE) throw new Error('The sticker image must not exceed 10 MiB.')
      const form = new FormData()
      form.append('file', blob, fileName)
      const response = await fetch('/api/admin/upload/photo', { method: 'POST', headers: { Authorization: `Bearer ${auth.access_token}` }, body: form })
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
      const data = await response.json()
      const photoUrl = data.data && data.data.photoUrl
      let parsedPhotoUrl
      try { parsedPhotoUrl = typeof photoUrl === 'string' ? new URL(photoUrl) : null } catch (_) { parsedPhotoUrl = null }
      if (!parsedPhotoUrl || parsedPhotoUrl.protocol !== 'https:' || !parsedPhotoUrl.hostname) throw new Error('Upload succeeded but no valid HTTPS photoUrl was returned.')
      result = { ok: true, photoUrl, message: 'Uploaded.' }
    } catch (error) { result = { ok: false, message: error.message || String(error) } }
    document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadResult', { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
