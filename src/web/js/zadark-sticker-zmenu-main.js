/* zmenu.zalo.me MAIN-world upload bridge. */
(function () {
  const UPLOAD_PROTOCOL = 'binary-upload-v3'
  const RESIZE_THRESHOLD = 1024 * 1024
  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024
  const MAX_IMAGE_DIMENSION = 512
  const OPENAPI_TOKEN_PATH = '/api/auth/openapi/access_token'
  const OPENAPI_TOKEN_STORAGE_KEY = '@ZaDark:zmenu-openapi-access-token'
  let openApiAccessToken = null
  const logTokenStep = (step, phase, action, decision, details = {}) => {
    console.log(`[ZaDarkSticker] zmenu token step ${step}/8`, { phase, action, decision, ...details })
  }
  const logSkippedTokenStep = (step, action, reason) => {
    logTokenStep(step, 'start', action, 'evaluate whether this fallback is needed')
    logTokenStep(step, 'end', action, `skipped; ${reason}`)
  }
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
    logTokenStep(2, 'start', 'Check the in-memory token cache.', 'checking')
    if (openApiAccessToken) {
      logTokenStep(2, 'end', 'Check the in-memory token cache.', 'use in-memory token')
      logSkippedTokenStep(3, 'Check the sessionStorage token cache.', 'in-memory token selected')
      logSkippedTokenStep(4, 'Check localStorage zalo.auth_data.', 'in-memory token selected')
      return { accessToken: openApiAccessToken, source: 'captured OpenAPI response' }
    }
    logTokenStep(2, 'end', 'Check the in-memory token cache.', 'not found; continue to session cache')
    logTokenStep(3, 'start', 'Check the sessionStorage token cache.', 'checking')
    try {
      const sessionToken = sessionStorage.getItem(OPENAPI_TOKEN_STORAGE_KEY)
      if (sessionToken) {
        logTokenStep(3, 'end', 'Check the sessionStorage token cache.', 'use session token')
        logSkippedTokenStep(4, 'Check localStorage zalo.auth_data.', 'session token selected')
        return { accessToken: sessionToken, source: 'captured OpenAPI session cache' }
      }
      logTokenStep(3, 'end', 'Check the sessionStorage token cache.', 'not found; continue to local OAuth data')
    } catch (error) {
      logTokenStep(3, 'end', 'Check the sessionStorage token cache.', 'unavailable; continue to local OAuth data', { message: error && error.message ? error.message : String(error) })
    }
    logTokenStep(4, 'start', 'Check localStorage zalo.auth_data.', 'checking')
    try {
      const auth = JSON.parse(localStorage.getItem('zalo.auth_data') || '{}')
      if (typeof auth.access_token === 'string' && auth.access_token) {
        logTokenStep(4, 'end', 'Check localStorage zalo.auth_data.', 'use local OAuth token')
        return { accessToken: auth.access_token, source: 'legacy zalo.auth_data fallback' }
      }
      logTokenStep(4, 'end', 'Check localStorage zalo.auth_data.', 'no token available')
    } catch (error) {
      logTokenStep(4, 'end', 'Check localStorage zalo.auth_data.', 'invalid or unavailable OAuth data', { message: error && error.message ? error.message : String(error) })
    }
    return null
  }

  const getZmenuAccessToken = async () => {
    logTokenStep(1, 'start', 'Ask ZaloOAuth SDK for an access token.', 'checking SDK availability and token state')
    if (window.ZaloOAuth && typeof window.ZaloOAuth.getAccessToken === 'function') {
      try {
        const data = await window.ZaloOAuth.getAccessToken()
        captureOpenApiToken(data)
        if (data && typeof data.access_token === 'string' && data.access_token) {
          logTokenStep(1, 'end', 'Ask ZaloOAuth SDK for an access token.', 'use SDK token')
          logSkippedTokenStep(2, 'Check the in-memory token cache.', 'SDK token selected')
          logSkippedTokenStep(3, 'Check the sessionStorage token cache.', 'SDK token selected')
          logSkippedTokenStep(4, 'Check localStorage zalo.auth_data.', 'SDK token selected')
          return { accessToken: data.access_token, source: 'ZaloOAuth SDK' }
        }
        throw new Error('The ZaloOAuth SDK returned no access token.')
      } catch (error) {
        logTokenStep(1, 'end', 'Ask ZaloOAuth SDK for an access token.', 'SDK failed; continue to caches', { message: error && error.message ? error.message : String(error) })
        console.warn('[ZaDarkSticker] ZaloOAuth SDK token lookup failed; using cached fallback', error && error.message ? error.message : String(error))
      }
    } else {
      logTokenStep(1, 'end', 'Ask ZaloOAuth SDK for an access token.', 'SDK unavailable; continue to caches')
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
      logTokenStep(8, 'end', 'Refresh the rejected OAuth token.', 'refresh succeeded; retry upload once', { status: response.status })
      return true
    } catch (error) {
      logTokenStep(8, 'end', 'Refresh the rejected OAuth token.', 'refresh failed; stop upload', { message: error && error.message ? error.message : String(error) })
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

  const replaceFileExtension = (fileName, mimeType) => {
    const baseName = safeFileName(fileName, '').replace(/\.[a-zA-Z0-9]{1,8}$/, '') || 'sticker'
    return `${baseName}.${MIME_EXTENSIONS[mimeType] || 'png'}`
  }

  const encodeImage = async (blob, fileName, outputMimeType, resize) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('The sticker image could not be decoded for conversion.'))
        image.src = objectUrl
      })
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height) throw new Error('The sticker image has invalid dimensions.')
      const scale = resize ? Math.min(1, MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height) : 1
      const outputWidth = Math.max(1, Math.round(width * scale))
      const outputHeight = Math.max(1, Math.round(height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = outputWidth
      canvas.height = outputHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not create an image conversion context.')
      context.drawImage(image, 0, 0, outputWidth, outputHeight)
      const outputBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode the sticker image.')), outputMimeType, 0.92)
      })
      if (!outputBlob.size) throw new Error('The converted sticker file is empty.')
      if (outputBlob.type !== outputMimeType) throw new Error(`Could not encode the sticker image as ${outputMimeType}.`)
      const outputFileName = replaceFileExtension(fileName, outputMimeType)
      console.debug('[ZaDarkSticker] zmenu MAIN image conversion', {
        width: outputWidth,
        height: outputHeight,
        inputMimeType: blob.type,
        outputMimeType: outputBlob.type,
        inputSize: blob.size,
        outputSize: outputBlob.size,
        fileName: outputFileName
      })
      return { blob: outputBlob, fileName: outputFileName }
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  const processImage = async (blob, fileName) => {
    const mimeType = blob.type.toLowerCase()
    const oversized = blob.size > RESIZE_THRESHOLD
    if (mimeType === 'image/gif') {
      if (oversized) throw new Error('GIF images larger than 1 MiB are unsupported.')
      return { blob, fileName }
    }
    if (mimeType === 'image/jpeg') return encodeImage(blob, fileName, 'image/webp', oversized)
    if (!oversized) return { blob, fileName }
    const outputMimeType = mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/png'
    return encodeImage(blob, fileName, outputMimeType, true)
  }

  const downloadSourceImage = async (sourceUrl) => {
    let response
    console.log('[ZaDarkSticker] zmenu MAIN source download request', {
      method: 'GET',
      sourceUrl: sourceUrl.href,
      credentials: 'omit',
      body: null
    })
    try {
      response = await fetch(sourceUrl.href, { credentials: 'omit' })
    } catch (_) {
      const message = 'The source image could not be downloaded by zmenu. The image host may block cross-origin requests.'
      console.error('[ZaDarkSticker] zmenu MAIN source download response', { ok: false, message })
      throw new Error(message)
    }
    const contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
    console.log('[ZaDarkSticker] zmenu MAIN source download response', { status: response.status, ok: response.ok, contentType })
    if (!response.ok) throw new Error(`The source image could not be downloaded by zmenu: HTTP ${response.status}.`)
    if (!contentType.startsWith('image/')) throw new Error('The source URL did not return an image Content-Type.')
    try {
      const blob = await response.blob()
      console.log('[ZaDarkSticker] zmenu MAIN source download body', { status: response.status, contentType, size: blob.size })
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
    console.log('[ZaDarkSticker] zmenu MAIN request received', {
      id: request.id,
      body: {
        protocol: payload.protocol,
        sourceType,
        sourceUrl: payload.sourceUrl,
        fileName: payload.fileName,
        dataUrl: typeof payload.dataUrl === 'string' ? `[data URL, ${payload.dataUrl.length} characters]` : undefined
      }
    })
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
      const converted = await processImage(blob, fileName)
      blob = converted.blob
      fileName = converted.fileName
      if (!blob.size) throw new Error('The converted sticker file is empty.')
      if (blob.size > MAX_UPLOAD_SIZE) throw new Error('The converted sticker image must not exceed 10 MiB.')
      const upload = async () => {
        const auth = await getZmenuAccessToken()
        logTokenStep(5, 'start', 'Finalize token selection for the photo upload.', 'evaluating acquisition result')
        if (!auth) {
          logTokenStep(5, 'end', 'Finalize token selection for the photo upload.', 'no token; stop upload')
          throw new Error('No zmenu OpenAPI access token. Sign out and sign in again so the extension can capture the access-token response.')
        }
        logTokenStep(5, 'end', 'Finalize token selection for the photo upload.', 'token selected; continue to upload', { source: auth.source })
        const form = new FormData()
        form.append('file', blob, fileName)
        console.log('[ZaDarkSticker] zmenu MAIN multipart upload request', {
          method: 'POST',
          url: '/api/admin/upload/photo',
          headers: { Authorization: 'Bearer [redacted]' },
          body: { file: { name: fileName, type: blob.type, size: blob.size } },
          authorizationSource: auth.source
        })
        let response
        logTokenStep(6, 'start', 'Send the authorized photo upload request.', 'sending', { authorizationSource: auth.source })
        try {
          response = await fetch('/api/admin/upload/photo', { method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}` }, body: form })
        } catch (error) {
          const message = error && error.message ? error.message : 'The zmenu upload request failed.'
          logTokenStep(6, 'end', 'Send the authorized photo upload request.', 'network request failed', { message })
          console.error('[ZaDarkSticker] zmenu MAIN multipart upload response', { ok: false, message })
          throw new Error(message)
        }
        logTokenStep(6, 'end', 'Send the authorized photo upload request.', 'response received; inspect response', { status: response.status, ok: response.ok })
        console.log('[ZaDarkSticker] zmenu MAIN multipart upload response', { status: response.status, ok: response.ok })
        let data
        logTokenStep(7, 'start', 'Inspect the upload response and token status.', 'parsing response')
        try {
          data = await response.json()
          uploadResponse = data
        } catch (error) {
          logTokenStep(7, 'end', 'Inspect the upload response and token status.', 'invalid JSON; stop upload', { status: response.status })
          console.error('[ZaDarkSticker] zmenu MAIN upload JSON parse failed', error && error.message ? error.message : 'Unknown JSON parse failure.')
          if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
          throw new Error('Upload returned an invalid JSON response.')
        }
        console.log('[ZaDarkSticker] zmenu MAIN upload response body', {
          status: response.status,
          ok: response.ok,
          body: data
        })
        const apiError = hasApiError(data)
        logTokenStep(7, 'end', 'Inspect the upload response and token status.', apiError
          ? (Number(data.error) === -115 ? 'token rejected; continue to refresh step' : 'API error; continue to final error handling')
          : (response.ok ? 'token accepted; upload response is successful' : 'HTTP error; continue to final error handling'), {
          status: response.status,
          error: data && data.error,
          message: data && data.message
        })
        return { response, data }
      }
      let uploaded = await upload()
      if (hasApiError(uploaded.data) && Number(uploaded.data.error) === -115) {
        const tokenErrorMessage = getApiErrorMessage(uploaded.data)
        logTokenStep(8, 'start', 'Refresh the rejected OAuth token.', 'clear extension cache and request one refresh')
        clearOpenApiTokenCache()
        if (!await refreshOpenApiToken()) throw new Error(tokenErrorMessage)
        uploaded = await upload()
      } else {
        logTokenStep(8, 'start', 'Decide whether the OAuth token needs explicit refresh.', 'checking upload response')
        logTokenStep(8, 'end', 'Decide whether the OAuth token needs explicit refresh.', 'refresh not needed')
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
    console.log('[ZaDarkSticker] zmenu MAIN result', { id: request.id, ok: result.ok, message: result.message, photoUrl: result.photoUrl, uploadResponse: result.uploadResponse })
    document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadResult:v3', { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
