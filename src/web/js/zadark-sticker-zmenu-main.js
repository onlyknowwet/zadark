/* zmenu.zalo.me MAIN-world upload bridge. */
(function () {
  const UPLOAD_PROTOCOL = 'binary-upload-v3'
  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024
  const OPENAPI_TOKEN_PATH = '/api/auth/openapi/access_token'
  const OPENAPI_TOKEN_STORAGE_KEY = '@ZaDark:zmenu-openapi-access-token'
  let openApiAccessToken = null
  const MIME_EXTENSIONS = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp'
  }

  const isOpenApiTokenUrl = (value) => {
    try { return new URL(value, location.href).pathname === OPENAPI_TOKEN_PATH } catch (_) { return false }
  }

  const captureOpenApiToken = (data) => {
    const accessToken = data && typeof data.access_token === 'string'
      ? data.access_token
      : data && data.data && typeof data.data.access_token === 'string' ? data.data.access_token : null
    if (!accessToken) return
    openApiAccessToken = accessToken
    try { sessionStorage.setItem(OPENAPI_TOKEN_STORAGE_KEY, accessToken) } catch (_) {}
    console.debug('[ZaDarkSticker] captured zmenu OpenAPI access token', {
      source: 'openapi/access_token response',
      expiresIn: data.expires_in || (data.data && data.data.expires_in)
    })
  }

  const observeOpenApiTokenResponse = (data) => {
    try { captureOpenApiToken(data) } catch (error) {
      console.warn('[ZaDarkSticker] could not capture zmenu OpenAPI access token', error && error.message ? error.message : String(error))
    }
  }

  const installOpenApiTokenCapture = () => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const input = args[0]
      const requestUrl = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input || '')
      if (isOpenApiTokenUrl(requestUrl)) {
        response.clone().json().then(observeOpenApiTokenResponse).catch(() => {})
      }
      return response
    }

    const originalOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      this.__zadarkOpenApiTokenRequest = isOpenApiTokenUrl(String(url || ''))
      if (!this.__zadarkOpenApiTokenListener) {
        this.__zadarkOpenApiTokenListener = true
        this.addEventListener('load', function () {
          if (!this.__zadarkOpenApiTokenRequest) return
          try {
            const data = this.responseType === 'json' && this.response
              ? this.response
              : JSON.parse(this.responseText || '{}')
            observeOpenApiTokenResponse(data)
          } catch (_) {}
        })
      }
      return originalOpen.call(this, method, url, ...args)
    }
  }

  const getCachedZmenuAccessToken = () => {
    if (openApiAccessToken) return { accessToken: openApiAccessToken, source: 'captured OpenAPI response' }
    try {
      const sessionToken = sessionStorage.getItem(OPENAPI_TOKEN_STORAGE_KEY)
      if (sessionToken) return { accessToken: sessionToken, source: 'captured OpenAPI session cache' }
    } catch (_) {}
    try {
      const auth = JSON.parse(localStorage.getItem('zalo.auth_data') || '{}')
      if (typeof auth.access_token === 'string' && auth.access_token) return { accessToken: auth.access_token, source: 'legacy zalo.auth_data fallback' }
    } catch (_) {}
    return null
  }

  const getZmenuAccessToken = async () => {
    if (window.ZaloOAuth && typeof window.ZaloOAuth.getAccessToken === 'function') {
      try {
        const data = await window.ZaloOAuth.getAccessToken()
        captureOpenApiToken(data)
        if (data && typeof data.access_token === 'string' && data.access_token) {
          return { accessToken: data.access_token, source: 'ZaloOAuth SDK' }
        }
        throw new Error('The ZaloOAuth SDK returned no access token.')
      } catch (error) {
        console.warn('[ZaDarkSticker] ZaloOAuth SDK token lookup failed; using cached fallback', error && error.message ? error.message : String(error))
      }
    }
    return getCachedZmenuAccessToken()
  }

  const clearOpenApiTokenCache = () => {
    openApiAccessToken = null
    try { sessionStorage.removeItem(OPENAPI_TOKEN_STORAGE_KEY) } catch (_) {}
  }

  const hasApiError = (data) => data && data.error !== null && data.error !== undefined && data.error !== 0 && data.error !== '0'

  const getApiErrorMessage = (data) => {
    if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim()
    return `Upload failed with API error ${String(data && data.error)}.`
  }

  const refreshOpenApiToken = async () => {
    try {
      const auth = JSON.parse(localStorage.getItem('zalo.auth_data') || '{}')
      const refreshToken = auth && auth.refresh_token
      const appId = window.ZPAGE_CONFIG && window.ZPAGE_CONFIG.APP_ID
      if (typeof refreshToken !== 'string' || !refreshToken || !appId) throw new Error('OAuth refresh credentials are unavailable.')
      const body = new URLSearchParams({ refresh_token: refreshToken, app_id: String(appId), grant_type: 'refresh_token' })
      const response = await fetch(OPENAPI_TOKEN_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      const data = await response.json()
      if (!response.ok || hasApiError(data) || typeof data.access_token !== 'string' || !data.access_token) {
        throw new Error(!response.ok ? `OAuth refresh failed: HTTP ${response.status}.` : 'OAuth refresh returned no access token.')
      }
      const updatedAuth = { ...auth, ...data }
      const expiresIn = Number(data.expires_in)
      if (Number.isFinite(expiresIn)) updatedAuth.expires_at = Date.now() + expiresIn * 1000
      localStorage.setItem('zalo.auth_data', JSON.stringify(updatedAuth))
      captureOpenApiToken(data)
      return true
    } catch (error) {
      console.warn('[ZaDarkSticker] explicit OAuth refresh failed', error && error.message ? error.message : String(error))
      return false
    }
  }

  installOpenApiTokenCapture()

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

  const replaceWithWebpExtension = (fileName) => {
    const baseName = safeFileName(fileName, '').replace(/\.[a-zA-Z0-9]{1,8}$/, '') || 'sticker'
    return `${baseName}.webp`
  }

  const convertJpegToWebp = async (blob, fileName) => {
    if (blob.type !== 'image/jpeg') return { blob, fileName }
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('The JPEG sticker could not be decoded for WebP conversion.'))
        image.src = objectUrl
      })
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height) throw new Error('The JPEG sticker has invalid dimensions.')
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not create a JPEG conversion context.')
      context.drawImage(image, 0, 0, width, height)
      const webpBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode the JPEG sticker as WebP.')), 'image/webp', 0.92)
      })
      const webpFileName = replaceWithWebpExtension(fileName)
      console.debug('[ZaDarkSticker] zmenu MAIN JPEG to WebP conversion', {
        width,
        height,
        inputMimeType: blob.type,
        outputMimeType: webpBlob.type,
        inputSize: blob.size,
        outputSize: webpBlob.size,
        fileName: webpFileName
      })
      return { blob: webpBlob, fileName: webpFileName }
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

  document.addEventListener('@ZaDark:Sticker:UploadRequest:v3', async (event) => {
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
      const converted = await convertJpegToWebp(blob, fileName)
      blob = converted.blob
      fileName = converted.fileName
      if (!blob.size) throw new Error('The converted sticker file is empty.')
      if (blob.size > MAX_UPLOAD_SIZE) throw new Error('The converted sticker image must not exceed 10 MiB.')
      const upload = async () => {
        const auth = await getZmenuAccessToken()
        if (!auth) throw new Error('No zmenu OpenAPI access token. Sign out and sign in again so the extension can capture the access-token response.')
        const form = new FormData()
        form.append('file', blob, fileName)
        console.debug('[ZaDarkSticker] zmenu MAIN multipart upload request', {
          endpoint: '/api/admin/upload/photo', fileName, mimeType: blob.type, size: blob.size, authorizationSource: auth.source
        })
        let response
        try {
          response = await fetch('/api/admin/upload/photo', { method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}` }, body: form })
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
        return { response, data }
      }
      let uploaded = await upload()
      if (hasApiError(uploaded.data) && Number(uploaded.data.error) === -115) {
        const tokenErrorMessage = getApiErrorMessage(uploaded.data)
        clearOpenApiTokenCache()
        if (!await refreshOpenApiToken()) throw new Error(tokenErrorMessage)
        uploaded = await upload()
      }
      const { response, data } = uploaded
      if (hasApiError(data)) throw new Error(getApiErrorMessage(data))
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
      const photoUrl = data.data && data.data.photoUrl
      let parsedPhotoUrl
      try { parsedPhotoUrl = typeof photoUrl === 'string' ? new URL(photoUrl) : null } catch (_) { parsedPhotoUrl = null }
      if (!parsedPhotoUrl || parsedPhotoUrl.protocol !== 'https:' || !parsedPhotoUrl.hostname) throw new Error('Upload succeeded but no valid HTTPS photoUrl was returned.')
      result = { ok: true, photoUrl, message: 'Uploaded.', uploadResponse }
    } catch (error) { result = { ok: false, message: error.message || String(error), uploadResponse } }
    console.debug('[ZaDarkSticker] zmenu MAIN result', { id: request.id, ok: result.ok, message: result.message, photoUrl: result.photoUrl, uploadResponse: result.uploadResponse })
    document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadResult:v3', { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
