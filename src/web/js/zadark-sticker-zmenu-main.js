/* zmenu.zalo.me MAIN-world upload bridge. */
(function () {
  const UPLOAD_PROTOCOL = 'source-url-v2'
  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024
  const MAX_STICKER_DIMENSION = 512
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

  const resizedMimeType = (mimeType) => ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
    ? mimeType
    : 'image/png'

  const replaceFileExtension = (fileName, mimeType) => {
    const extension = MIME_EXTENSIONS[mimeType] || 'png'
    const baseName = safeFileName(fileName, '').replace(/\.[a-zA-Z0-9]{1,8}$/, '') || 'sticker'
    return `${baseName}.${extension}`
  }

  const resizeImageBlob = async (blob, fileName) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('The sticker image could not be decoded for resizing.'))
        image.src = objectUrl
      })
      const originalWidth = image.naturalWidth
      const originalHeight = image.naturalHeight
      if (!originalWidth || !originalHeight) throw new Error('The sticker image has invalid dimensions.')
      if (blob.type === 'image/gif') {
        console.debug('[ZaDarkSticker] zmenu MAIN resize result', {
          resized: false,
          reason: 'animated GIF preserved unchanged',
          originalWidth,
          originalHeight,
          width: originalWidth,
          height: originalHeight,
          mimeType: blob.type,
          size: blob.size
        })
        return { blob, fileName }
      }
      if (originalWidth <= MAX_STICKER_DIMENSION && originalHeight <= MAX_STICKER_DIMENSION) {
        console.debug('[ZaDarkSticker] zmenu MAIN resize result', {
          resized: false,
          originalWidth,
          originalHeight,
          width: originalWidth,
          height: originalHeight,
          mimeType: blob.type,
          size: blob.size
        })
        return { blob, fileName }
      }
      const scale = Math.min(MAX_STICKER_DIMENSION / originalWidth, MAX_STICKER_DIMENSION / originalHeight)
      const width = Math.max(1, Math.round(originalWidth * scale))
      const height = Math.max(1, Math.round(originalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not create an image resizing context.')
      context.drawImage(image, 0, 0, width, height)
      const outputMimeType = resizedMimeType(blob.type)
      const resizedBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode the resized sticker image.')), outputMimeType, 0.92)
      })
      const resizedFileName = replaceFileExtension(fileName, outputMimeType)
      console.debug('[ZaDarkSticker] zmenu MAIN resize result', {
        resized: true,
        originalWidth,
        originalHeight,
        width,
        height,
        inputMimeType: blob.type,
        outputMimeType,
        inputSize: blob.size,
        outputSize: resizedBlob.size
      })
      return { blob: resizedBlob, fileName: resizedFileName }
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  const downloadSourceImage = async (sourceUrl) => {
    let response
    console.debug('[ZaDarkSticker] zmenu MAIN source download request', {
      sourceUrl: sourceUrl.href,
      credentials: 'omit'
    })
    try {
      response = await fetch(sourceUrl.href, { credentials: 'omit' })
    } catch (_) {
      const message = 'The source image could not be downloaded by zmenu. The image host may block cross-origin requests.'
      console.error('[ZaDarkSticker] zmenu MAIN source download response', { ok: false, message })
      throw new Error(message)
    }
    const contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
    console.debug('[ZaDarkSticker] zmenu MAIN source download response', { status: response.status, contentType })
    if (!response.ok) throw new Error(`The source image could not be downloaded by zmenu: HTTP ${response.status}.`)
    if (!contentType.startsWith('image/')) throw new Error('The source URL did not return an image Content-Type.')
    try {
      const blob = await response.blob()
      console.debug('[ZaDarkSticker] zmenu MAIN source download body', { status: response.status, contentType, size: blob.size })
      return { blob, contentType }
    } catch (_) {
      throw new Error('The source image could not be downloaded by zmenu. The image host may block cross-origin requests.')
    }
  }

  document.addEventListener('@ZaDark:Sticker:UploadRequest', async (event) => {
    let request
    try { request = JSON.parse(event.detail) } catch (_) {
      console.error('[ZaDarkSticker] zmenu MAIN received malformed upload JSON')
      return
    }
    if (!request || typeof request.id !== 'string') {
      console.error('[ZaDarkSticker] zmenu MAIN upload request is missing a valid id')
      return
    }
    const payload = request.payload || {}
    const sourceType = payload.sourceType || (typeof payload.sourceUrl === 'string' ? 'url' : 'file')
    console.debug('[ZaDarkSticker] zmenu MAIN request', { id: request.id, protocol: payload.protocol, sourceType })
    let result
    let uploadResponse
    try {
      if (payload.protocol !== UPLOAD_PROTOCOL) throw new Error('Incompatible sticker upload request. Reload all zmenu tabs after updating the extension.')
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
      const resized = await resizeImageBlob(blob, fileName)
      blob = resized.blob
      fileName = resized.fileName
      if (!blob.size) throw new Error('The resized sticker file is empty.')
      if (blob.size > MAX_UPLOAD_SIZE) throw new Error('The resized sticker image must not exceed 10 MiB.')
      const form = new FormData()
      form.append('file', blob, fileName)
      console.debug('[ZaDarkSticker] zmenu MAIN multipart upload request', {
        endpoint: '/api/admin/upload/photo',
        fileName,
        mimeType: blob.type,
        size: blob.size
      })
      let response
      try {
        response = await fetch('/api/admin/upload/photo', { method: 'POST', headers: { Authorization: `Bearer ${auth.access_token}` }, body: form })
      } catch (error) {
        const message = error && error.message ? error.message : 'The zmenu upload request failed.'
        console.error('[ZaDarkSticker] zmenu MAIN multipart upload response', { ok: false, message })
        throw new Error(message)
      }
      console.debug('[ZaDarkSticker] zmenu MAIN multipart upload response', { status: response.status })
      let data
      try {
        data = await response.json()
        uploadResponse = data
      } catch (error) {
        console.error('[ZaDarkSticker] zmenu MAIN upload JSON parse failed', error && error.message ? error.message : 'Unknown JSON parse failure.')
        if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
        throw new Error('Upload returned an invalid JSON response.')
      }
      console.debug('[ZaDarkSticker] zmenu MAIN upload JSON response', data)
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
      const photoUrl = data.data && data.data.photoUrl
      let parsedPhotoUrl
      try { parsedPhotoUrl = typeof photoUrl === 'string' ? new URL(photoUrl) : null } catch (_) { parsedPhotoUrl = null }
      if (!parsedPhotoUrl || parsedPhotoUrl.protocol !== 'https:' || !parsedPhotoUrl.hostname) throw new Error('Upload succeeded but no valid HTTPS photoUrl was returned.')
      result = { ok: true, photoUrl, message: 'Uploaded.', uploadResponse }
    } catch (error) { result = { ok: false, message: error.message || String(error), uploadResponse } }
    console.debug('[ZaDarkSticker] zmenu MAIN result', { id: request.id, ok: result.ok, message: result.message, photoUrl: result.photoUrl, uploadResponse: result.uploadResponse })
    document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadResult', { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
