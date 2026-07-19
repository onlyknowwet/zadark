/* zmenu.zalo.me MAIN-world upload bridge. */
(function () {
  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024

  document.addEventListener('@ZaDark:Sticker:UploadRequest', async (event) => {
    let request
    try { request = JSON.parse(event.detail) } catch (_) { return }
    if (!request || typeof request.id !== 'string') return
    let result
    try {
      const payload = request.payload || {}
      if (typeof payload.dataUrl !== 'string' || !payload.dataUrl.startsWith('data:') || typeof payload.fileName !== 'string' || !payload.fileName.trim()) throw new Error('Malformed sticker file data.')
      const auth = JSON.parse(localStorage.getItem('zalo.auth_data') || '{}')
      if (!auth.access_token) throw new Error('No authenticated zmenu session. Open zmenu.zalo.me and sign in first.')
      const blobResponse = await fetch(payload.dataUrl)
      const blob = await blobResponse.blob()
      if (!blob.size) throw new Error('The sticker file is empty.')
      if (!blob.type || !blob.type.startsWith('image/')) throw new Error('The sticker file must be an image.')
      if (blob.size > MAX_UPLOAD_SIZE) throw new Error('The sticker image must not exceed 10 MiB.')
      const form = new FormData()
      form.append('file', blob, payload.fileName)
      const response = await fetch('/api/admin/upload/photo', { method: 'POST', headers: { Authorization: `Bearer ${auth.access_token}` }, body: form })
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
      const data = await response.json()
      const photoUrl = data.data && data.data.photoUrl
      if (typeof photoUrl !== 'string' || new URL(photoUrl).protocol !== 'https:') throw new Error('Upload succeeded but no valid HTTPS photoUrl was returned.')
      result = { ok: true, photoUrl, message: 'Uploaded.' }
    } catch (error) { result = { ok: false, message: error.message || String(error) } }
    document.dispatchEvent(new CustomEvent('@ZaDark:Sticker:UploadResult', { detail: JSON.stringify({ id: request.id, result }) }))
  })
})()
