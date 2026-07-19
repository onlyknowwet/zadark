/* ZaDark sticker panel UI. */

(function () {
  const STICKER_MAX_FILE_SIZE = 10 * 1024 * 1024
  const STICKER_PANEL_ID = 'js-zadark-sticker-panel'
  let stickerBusy = false
  let trustedStickerUrl = null

  const stickerPanelHTML = `
    <section id="js-zadark-sticker-panel" class="zadark-panel zadark-sticker-panel" aria-labelledby="zadark-sticker-title">
      <div class="zadark-panel__body">
        <div class="zadark-sticker-panel__heading">
          <div>
            <h2 id="zadark-sticker-title">Gửi sticker ảnh</h2>
            <p>Dùng ảnh từ máy hoặc dán URL HTTPS.</p>
          </div>
        </div>

        <div id="js-zadark-sticker-dropzone" class="zadark-sticker-dropzone" role="button" tabindex="0" aria-controls="js-zadark-sticker-file">
          <input id="js-zadark-sticker-file" class="zadark-sticker-dropzone__input" type="file" accept="image/*" />
          <span class="zadark-sticker-dropzone__icon" aria-hidden="true">↑</span>
          <span><strong>Kéo thả ảnh vào đây</strong> hoặc <span class="zadark-sticker-dropzone__link">chọn tệp</span></span>
          <small>JPG, PNG, GIF hoặc WebP · tối đa 10MB</small>
        </div>

        <label class="zadark-sticker-field" for="js-zadark-sticker-url">
          <span>URL ảnh</span>
          <input id="js-zadark-sticker-url" class="zadark-input" type="url" inputmode="url" placeholder="https://example.com/anh.png" autocomplete="off" />
        </label>

        <p class="zadark-sticker-note">Tải ảnh từ máy cần một tab <a href="https://zmenu.zalo.me" target="_blank" rel="noopener noreferrer">zmenu.zalo.me</a> đang mở và đã đăng nhập.</p>
        <div id="js-zadark-sticker-status" class="zadark-sticker-status" role="status" aria-live="polite"></div>
        <button id="js-zadark-sticker-send" class="zadark-sticker-send" type="button">Gửi sticker</button>
      </div>
    </section>
  `

  const getElement = (id) => document.getElementById(id)

  const setStickerStatus = (message = '', state = '') => {
    const statusEl = getElement('js-zadark-sticker-status')
    if (!statusEl) return
    statusEl.textContent = message
    statusEl.setAttribute('data-state', state)
  }

  const setStickerBusy = (busy) => {
    stickerBusy = busy
    getElement('js-zadark-sticker-send').disabled = busy
    getElement('js-zadark-sticker-url').disabled = busy
    getElement('js-zadark-sticker-file').disabled = busy
    const dropzoneEl = getElement('js-zadark-sticker-dropzone')
    dropzoneEl.setAttribute('aria-disabled', busy ? 'true' : 'false')
    dropzoneEl.classList.toggle('zadark-sticker-dropzone--busy', busy)
    getElement(STICKER_PANEL_ID).classList.toggle('zadark-sticker-panel--busy', busy)
  }

  const isValidStickerFile = (file) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      setStickerStatus('Vui lòng chọn một tệp hình ảnh.', 'error')
      return false
    }
    if (file.size > STICKER_MAX_FILE_SIZE) {
      setStickerStatus('Dung lượng ảnh tối đa là 10MB.', 'error')
      return false
    }
    return true
  }

  const uploadStickerFile = async (file) => {
    if (stickerBusy || !isValidStickerFile(file)) return
    setStickerBusy(true)
    setStickerStatus('Đang tải ảnh lên…', 'loading')
    try {
      const result = await ZaDarkSticker.upload(file)
      if (!result || !result.ok || !result.photoUrl) {
        setStickerStatus((result && result.message) || 'Không thể tải ảnh lên.', 'error')
        return
      }
      getElement('js-zadark-sticker-url').value = result.photoUrl
      trustedStickerUrl = result.photoUrl
      setStickerStatus('Đã tải ảnh. Kiểm tra URL rồi nhấn “Gửi sticker”.', 'success')
    } catch (error) {
      setStickerStatus(error.message || 'Không thể tải ảnh lên.', 'error')
    } finally {
      setStickerBusy(false)
    }
  }

  const isHttpsImageUrl = (value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !!url.hostname
    } catch (_) {
      return false
    }
  }

  const sendSticker = async () => {
    if (stickerBusy) return
    const urlEl = getElement('js-zadark-sticker-url')
    const stickerUrl = urlEl.value.trim()

    if (!isHttpsImageUrl(stickerUrl)) {
      setStickerStatus('Nhập một URL ảnh bắt đầu bằng https://.', 'error')
      urlEl.focus()
      return
    }
    if (!ZaDarkUtils.getCurrentConvId()) {
      setStickerStatus('Hãy mở một cuộc trò chuyện trước khi gửi.', 'error')
      return
    }

    setStickerBusy(true)
    try {
      let sendUrl = stickerUrl
      if (sendUrl !== trustedStickerUrl) {
        setStickerStatus('Đang tải ảnh lên…', 'loading')
        const uploadResult = await ZaDarkSticker.uploadUrl(sendUrl)
        if (!uploadResult || !uploadResult.ok || !uploadResult.photoUrl) {
          setStickerStatus((uploadResult && uploadResult.message) || 'Không thể tải ảnh lên.', 'error')
          return
        }
        sendUrl = uploadResult.photoUrl
        trustedStickerUrl = sendUrl
        urlEl.value = sendUrl
      }
      setStickerStatus('Đang gửi sticker…', 'loading')
      const result = await ZaDarkSticker.send({ stickerUrl: sendUrl })
      if (!result || !result.ok) {
        setStickerStatus((result && result.message) || 'Không thể gửi sticker.', 'error')
        return
      }
      setStickerStatus('Đã gửi sticker.', 'success')
    } catch (error) {
      setStickerStatus(error.message || 'Không thể gửi sticker.', 'error')
    } finally {
      setStickerBusy(false)
    }
  }

  const bindStickerPanel = (panelEl) => {
    const dropzoneEl = getElement('js-zadark-sticker-dropzone')
    const fileInputEl = getElement('js-zadark-sticker-file')
    const urlEl = getElement('js-zadark-sticker-url')
    if (!dropzoneEl || !fileInputEl || !urlEl) return

    fileInputEl.addEventListener('change', () => {
      uploadStickerFile(fileInputEl.files[0])
      fileInputEl.value = ''
    })
    dropzoneEl.addEventListener('click', (event) => {
      if (!stickerBusy && event.target !== fileInputEl) fileInputEl.click()
    })
    dropzoneEl.addEventListener('keydown', (event) => {
      if (stickerBusy || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      fileInputEl.click()
    })
    urlEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendSticker()
    })
    urlEl.addEventListener('input', () => {
      if (urlEl.value.trim() !== trustedStickerUrl) trustedStickerUrl = null
    })
    const dragEnterEvents = ['dragenter', 'dragover']
    dragEnterEvents.forEach((eventName) => {
      dropzoneEl.addEventListener(eventName, (event) => {
        event.preventDefault()
        if (!stickerBusy) dropzoneEl.classList.add('zadark-sticker-dropzone--active')
      })
    })
    const dragLeaveEvents = ['dragleave', 'drop']
    dragLeaveEvents.forEach((eventName) => {
      dropzoneEl.addEventListener(eventName, (event) => {
        event.preventDefault()
        dropzoneEl.classList.remove('zadark-sticker-dropzone--active')
      })
    })
    dropzoneEl.addEventListener('drop', (event) => {
      if (!stickerBusy && event.dataTransfer.files[0]) uploadStickerFile(event.dataTransfer.files[0])
    })
    getElement('js-zadark-sticker-send').addEventListener('click', sendSticker)
    panelEl.dataset.stickerBound = 'true'
  }

  const mountStickerPanel = () => {
    if (getElement(STICKER_PANEL_ID)) return
    const popupMainEl = document.querySelector('#js-zadark-popup .zadark-popup__main')
    if (!popupMainEl) return
    const panels = Array.from(popupMainEl.children).filter((child) => child.classList.contains('zadark-panel'))
    if (panels.length < 2) return

    const template = document.createElement('template')
    template.innerHTML = stickerPanelHTML.trim()
    const panelEl = template.content.firstElementChild
    panels[1].after(panelEl)
    bindStickerPanel(panelEl)
  }

  mountStickerPanel()
  const stickerObserver = new MutationObserver(mountStickerPanel)
  stickerObserver.observe(document.documentElement, { childList: true, subtree: true })
})()
