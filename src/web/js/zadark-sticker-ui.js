/* ZaDark sticker panel UI. */

(function () {
  const STICKER_MAX_FILE_SIZE = 10 * 1024 * 1024
  const STICKER_PANEL_ID = 'js-zadark-sticker-panel'
  const STICKER_TRIGGER_ID = 'zadark-sticker-toolbar-trigger'
  const STICKER_POPOVER_ID = 'zadark-sticker-toolbar-popover'
  let stickerBusy = false
  let compactStickerBusy = false
  let compactTrustedStickerUrl = null
  let compactGeneration = 0
  let trustedStickerUrl = null
  let compactTriggerEl = null
  let compactPopoverEl = null

  const stickerPanelHTML = `
    <section id="js-zadark-sticker-panel" class="zadark-panel zadark-sticker-panel" aria-labelledby="zadark-sticker-title" tabindex="-1">
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

        <label class="zadark-sticker-field" for="js-zadark-sticker-thumb-url">
          <span>Thumb URL <small>(tùy chọn)</small></span>
          <input id="js-zadark-sticker-thumb-url" class="zadark-input" type="url" inputmode="url" placeholder="Để trống để dùng URL ảnh" autocomplete="off" />
        </label>

        <p class="zadark-sticker-note">Tải ảnh từ máy cần một tab <a href="https://zmenu.zalo.me" target="_blank" rel="noopener noreferrer">zmenu.zalo.me</a> đang mở và đã đăng nhập.</p>
        <div id="js-zadark-sticker-status" class="zadark-sticker-status" role="status" aria-live="polite"></div>
        <button id="js-zadark-sticker-send" class="zadark-sticker-send" type="button">Gửi sticker</button>
      </div>
    </section>
  `

  const getElement = (id) => document.getElementById(id)

  const setCompactStatus = (message = '', state = '') => {
    if (!compactPopoverEl) return
    const statusEl = compactPopoverEl.querySelector('.zadark-sticker-toolbar-popover__status')
    statusEl.textContent = message
    statusEl.setAttribute('data-state', state)
  }

  const setCompactBusy = (busy) => {
    compactStickerBusy = busy
    if (!compactPopoverEl) return
    const inputEls = compactPopoverEl.querySelectorAll('input')
    const buttonEl = compactPopoverEl.querySelector('button')
    inputEls.forEach((inputEl) => { inputEl.disabled = busy })
    buttonEl.disabled = busy
    compactPopoverEl.setAttribute('aria-busy', busy ? 'true' : 'false')
  }

  const closeCompactPopover = (returnFocus = false) => {
    const triggerEl = compactTriggerEl
    const buttonEl = triggerEl && triggerEl.querySelector('button')
    if (compactPopoverEl) compactPopoverEl.remove()
    compactGeneration += 1
    compactTrustedStickerUrl = null
    compactStickerBusy = false
    compactPopoverEl = null
    compactTriggerEl = null
    if (triggerEl) triggerEl.classList.remove('selected')
    if (buttonEl) {
      buttonEl.setAttribute('aria-expanded', 'false')
      if (returnFocus) buttonEl.focus()
    }
  }

  const sendCompactSticker = async () => {
    if (compactStickerBusy || !compactPopoverEl) return
    const popoverEl = compactPopoverEl
    const generation = compactGeneration
    const isCurrent = () => compactPopoverEl === popoverEl && compactGeneration === generation
    const inputEl = compactPopoverEl.querySelector('input')
    const thumbInputEl = compactPopoverEl.querySelector('#zadark-sticker-toolbar-thumb-url')
    const stickerUrl = inputEl.value.trim()
    const thumbUrl = thumbInputEl.value.trim()

    if (!isHttpsImageUrl(stickerUrl)) {
      setCompactStatus('Nhập một URL ảnh bắt đầu bằng https://.', 'error')
      inputEl.focus()
      return
    }
    if (thumbUrl && !isHttpsImageUrl(thumbUrl)) {
      setCompactStatus('Thumb URL phải bắt đầu bằng https://.', 'error')
      thumbInputEl.focus()
      return
    }
    if (!ZaDarkUtils.getCurrentConvId()) {
      setCompactStatus('Hãy mở một cuộc trò chuyện trước khi gửi.', 'error')
      return
    }

    setCompactBusy(true)
    const isTrusted = stickerUrl === compactTrustedStickerUrl
    setCompactStatus(isTrusted ? 'Đang gửi sticker…' : 'Đang tải ảnh lên…', 'loading')
    try {
      let sendUrl = stickerUrl
      if (!isTrusted) {
        const uploadResult = await ZaDarkSticker.uploadUrl(stickerUrl)
        if (!isCurrent()) return
        if (!uploadResult || !uploadResult.ok || !uploadResult.photoUrl) {
          setCompactStatus((uploadResult && uploadResult.message) || 'Không thể tải ảnh lên.', 'error')
          return
        }
        sendUrl = uploadResult.photoUrl
        compactTrustedStickerUrl = sendUrl
        inputEl.value = sendUrl
      }
      setCompactStatus('Đang gửi sticker…', 'loading')
      const result = await ZaDarkSticker.send({ stickerUrl: sendUrl, thumbUrl })
      if (!isCurrent()) return
      if (!result || !result.ok) {
        setCompactStatus((result && result.message) || 'Không thể gửi sticker.', 'error')
        return
      }
      setCompactStatus('Đã gửi sticker.', 'success')
      inputEl.value = ''
      thumbInputEl.value = ''
      setTimeout(() => {
        if (isCurrent()) closeCompactPopover(false)
      }, 500)
    } catch (error) {
      if (isCurrent()) setCompactStatus(error.message || 'Không thể gửi sticker.', 'error')
    } finally {
      if (isCurrent()) setCompactBusy(false)
    }
  }

  const uploadCompactStickerFile = async (file) => {
    if (compactStickerBusy || !compactPopoverEl) return
    const popoverEl = compactPopoverEl
    const generation = compactGeneration
    const isCurrent = () => compactPopoverEl === popoverEl && compactGeneration === generation
    if (!file || !file.type || !file.type.startsWith('image/')) {
      setCompactStatus('Vui lòng chọn một tệp hình ảnh.', 'error')
      return
    }
    if (file.size > STICKER_MAX_FILE_SIZE) {
      setCompactStatus('Dung lượng ảnh tối đa là 10MB.', 'error')
      return
    }

    setCompactBusy(true)
    setCompactStatus('Đang tải ảnh lên…', 'loading')
    try {
      const result = await ZaDarkSticker.upload(file)
      if (!isCurrent()) return
      if (!result || !result.ok || !result.photoUrl) {
        setCompactStatus((result && result.message) || 'Không thể tải ảnh lên.', 'error')
        return
      }
      const inputEl = popoverEl.querySelector('input')
      compactTrustedStickerUrl = result.photoUrl
      inputEl.value = result.photoUrl
      setCompactStatus('Đã tải ảnh. Nhấn “Gửi” để gửi sticker.', 'success')
    } catch (error) {
      if (isCurrent()) setCompactStatus(error.message || 'Không thể tải ảnh lên.', 'error')
    } finally {
      if (isCurrent()) setCompactBusy(false)
    }
  }

  const openCompactPopover = (triggerEl) => {
    const triggerButtonEl = triggerEl.querySelector('button')
    triggerEl.insertAdjacentHTML('beforeend', `
      <div id="${STICKER_POPOVER_ID}" class="zadark-sticker-toolbar-popover" role="dialog" aria-label="Gửi sticker bằng ZaDark">
        <label class="zadark-sticker-toolbar-popover__field" for="zadark-sticker-toolbar-url">
          <span>URL ảnh</span>
          <input id="zadark-sticker-toolbar-url" type="url" inputmode="url" placeholder="https://..." autocomplete="off">
        </label>
        <label class="zadark-sticker-toolbar-popover__field zadark-sticker-toolbar-popover__field--thumb" for="zadark-sticker-toolbar-thumb-url">
          <span>Thumb URL <small>(tùy chọn)</small></span>
          <input id="zadark-sticker-toolbar-thumb-url" type="url" inputmode="url" placeholder="Để trống = URL ảnh" autocomplete="off">
        </label>
        <button type="button" class="zadark-sticker-toolbar-popover__send">Gửi</button>
        <div class="zadark-sticker-toolbar-popover__status" role="status" aria-live="polite"></div>
      </div>
    `)
    compactTriggerEl = triggerEl
    compactPopoverEl = getElement(STICKER_POPOVER_ID)
    compactGeneration += 1
    compactTrustedStickerUrl = null
    triggerEl.classList.add('selected')
    triggerButtonEl.setAttribute('aria-expanded', 'true')
    const inputEl = compactPopoverEl.querySelector('input')
    const thumbInputEl = compactPopoverEl.querySelector('#zadark-sticker-toolbar-thumb-url')
    inputEl.addEventListener('input', () => {
      if (inputEl.value.trim() !== compactTrustedStickerUrl) compactTrustedStickerUrl = null
    })
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        sendCompactSticker()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeCompactPopover(true)
      }
    })
    thumbInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        sendCompactSticker()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeCompactPopover(true)
      }
    })
    compactPopoverEl.querySelector('button').addEventListener('click', sendCompactSticker)
    const setDragActive = (active) => {
      if (!compactPopoverEl) return
      compactPopoverEl.classList.toggle('zadark-sticker-toolbar-popover--drag-active', active && !compactStickerBusy)
    }
    const compactDragEnterEvents = ['dragenter', 'dragover']
    compactDragEnterEvents.forEach((eventName) => {
      compactPopoverEl.addEventListener(eventName, (event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragActive(true)
      })
    })
    const compactDragLeaveEvents = ['dragleave', 'dragend']
    compactDragLeaveEvents.forEach((eventName) => {
      compactPopoverEl.addEventListener(eventName, (event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragActive(false)
      })
    })
    compactPopoverEl.addEventListener('drop', (event) => {
      event.preventDefault()
      event.stopPropagation()
      setDragActive(false)
      uploadCompactStickerFile(event.dataTransfer && event.dataTransfer.files[0])
    })
    inputEl.focus()
  }

  const toggleCompactPopover = (triggerEl) => {
    if (compactPopoverEl) {
      closeCompactPopover(true)
      return
    }
    openCompactPopover(triggerEl)
  }

  const handleCompactOutsideClick = (event) => {
    if (!compactPopoverEl || compactTriggerEl.contains(event.target) || compactPopoverEl.contains(event.target)) return
    closeCompactPopover(false)
  }

  const handleCompactEscape = (event) => {
    if (event.key === 'Escape' && compactPopoverEl) {
      event.preventDefault()
      closeCompactPopover(true)
    }
  }

  const mountStickerToolbarTrigger = () => {
    const toolbarEl = document.querySelector('#chat-box-bar-id .chat-box-toolbar')
    if (!toolbarEl) return

    const existingTrigger = document.getElementById(STICKER_TRIGGER_ID)
    if (existingTrigger && existingTrigger.parentElement === toolbarEl) return
    if (compactTriggerEl) closeCompactPopover(false)
    if (existingTrigger) existingTrigger.remove()

    const nativeStickerEl = Array.from(toolbarEl.children).find((child) => child.tagName === 'LI')
    if (!nativeStickerEl) return

    const triggerEl = document.createElement('li')
    triggerEl.id = STICKER_TRIGGER_ID
    triggerEl.dataset.zadarkStickerTrigger = 'true'
    triggerEl.className = 'zadark-sticker-toolbar-trigger'
    triggerEl.innerHTML = `
      <button type="button" class="zadark-sticker-toolbar-trigger__button" title="Gửi sticker bằng ZaDark" aria-label="Gửi sticker bằng ZaDark" aria-expanded="false" aria-controls="${STICKER_POPOVER_ID}">
        <i class="zadark-icon zadark-icon--zadark" aria-hidden="true"></i>
      </button>
    `
    const buttonEl = triggerEl.querySelector('button')
    buttonEl.addEventListener('click', () => toggleCompactPopover(triggerEl))
    toolbarEl.insertBefore(triggerEl, nativeStickerEl.nextSibling)
  }

  const isToolbarMutation = (record) => {
    const targetEl = record.target.nodeType === 1 ? record.target : record.target.parentElement
    if (targetEl && (targetEl.matches('#chat-box-bar-id .chat-box-toolbar') || targetEl.closest('#chat-box-bar-id .chat-box-toolbar'))) return true

    return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some((node) => {
      if (node.nodeType !== 1) return false
      return node.matches('#chat-box-bar-id .chat-box-toolbar') || node.querySelector('#chat-box-bar-id .chat-box-toolbar') || node.id === STICKER_TRIGGER_ID
    })
  }

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
    getElement('js-zadark-sticker-thumb-url').disabled = busy
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
    const thumbUrlEl = getElement('js-zadark-sticker-thumb-url')
    const stickerUrl = urlEl.value.trim()
    const thumbUrl = thumbUrlEl.value.trim()

    if (!isHttpsImageUrl(stickerUrl)) {
      setStickerStatus('Nhập một URL ảnh bắt đầu bằng https://.', 'error')
      urlEl.focus()
      return
    }
    if (thumbUrl && !isHttpsImageUrl(thumbUrl)) {
      setStickerStatus('Thumb URL phải bắt đầu bằng https://.', 'error')
      thumbUrlEl.focus()
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
      const result = await ZaDarkSticker.send({ stickerUrl: sendUrl, thumbUrl })
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
    const thumbUrlEl = getElement('js-zadark-sticker-thumb-url')
    if (!dropzoneEl || !fileInputEl || !urlEl || !thumbUrlEl) return

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
    thumbUrlEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendSticker()
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

  mountStickerToolbarTrigger()
  document.addEventListener('click', handleCompactOutsideClick, true)
  document.addEventListener('keydown', handleCompactEscape, true)
  const toolbarObserver = new MutationObserver((records) => {
    if (records.some(isToolbarMutation)) mountStickerToolbarTrigger()
  })
  toolbarObserver.observe(document.documentElement, { childList: true, subtree: true })
})()
