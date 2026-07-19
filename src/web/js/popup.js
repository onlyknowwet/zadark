/*
  ZaDark – Zalo Dark Mode
  Browser Extension
  Made by Quaric
*/

ZaDarkBrowser.initClassNames()
ZaDarkUtils.initOSName()
ZaDarkUtils.initTippy()
ZaDarkUtils.installFontFamily(['Open Sans:400;500;600'])

const MSG_ACTIONS = ZaDarkUtils.MSG_ACTIONS

const ratingElName = '#js-ext-rating'
const btnScrollElName = '#js-btn-scroll'

const radioInputThemeElName = '#js-radio-input-theme input:radio[name="theme"]'
const inputFontFamilyElName = '#js-input-font-family'
const selectFontSizeElName = '#js-select-font-size'
const selectTranslateTargetElName = '#js-select-translate-target'

const switchHideLatestMessageElName = '#js-switch-hide-latest-message'
const switchHideConvAvatarElName = '#js-switch-hide-conv-avatar'
const switchHideConvNameElName = '#js-switch-hide-conv-name'
const switchHideThreadChatMessageElName = '#js-switch-hide-thread-chat-message'

const switchBlockTypingElName = '#js-switch-block-typing'
const switchBlockSeenElName = '#js-switch-block-seen'
const switchBlockDeliveredElName = '#js-switch-block-delivered'

const switchUseHotkeysElName = '#js-switch-use-hotkeys'

const stickerPanelElName = '.zadark-sticker-panel'
const stickerDropzoneElName = '#js-sticker-dropzone'
const stickerFileInputElName = '#js-sticker-file'
const stickerUrlInputElName = '#js-sticker-url'
const stickerModeInputElName = 'input:radio[name="sticker-mode"]'
const stickerStatusElName = '#js-sticker-status'
const stickerSendButtonElName = '#js-sticker-send'
const stickerMaxFileSize = 10 * 1024 * 1024
let stickerBusy = false

$(ratingElName).attr('href', ZaDarkUtils.getRatingURL(ZaDarkBrowser.name))

ZaDarkBrowser.getExtensionSettings().then(async ({
  theme,
  fontFamily,
  fontSize,
  translateTarget,
  enabledHideLatestMessage,
  enabledHideConvAvatar,
  enabledHideConvName,
  enabledHideThreadChatMessage,
  useHotkeys
}) => {
  ZaDarkUtils.setPageTheme(theme)
  ZaDarkUtils.setUseHotkeysAttr(useHotkeys)

  // Migration: Convert old fontSize values to new numeric values
  const fontSizeMigrationMap = {
    small: '13',
    medium: '16',
    big: '18',
    'very-big': '20'
  }

  let migratedFontSize = fontSize
  if (fontSizeMigrationMap[fontSize]) {
    migratedFontSize = fontSizeMigrationMap[fontSize]
    // Save migrated value
    await ZaDarkBrowser.saveExtensionSettings({ fontSize: migratedFontSize })
    // Update Zalo tabs with new value
    ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_FONT_SIZE, { fontSize: migratedFontSize })
  }

  $(radioInputThemeElName).filter(`[value="${theme}"]`).attr('checked', true)
  $(inputFontFamilyElName).val(fontFamily).blur()
  $(selectFontSizeElName).val(migratedFontSize)
  $(selectTranslateTargetElName).setLanguagesOptions(translateTarget)

  $(switchHideLatestMessageElName).prop('checked', enabledHideLatestMessage)
  $(switchHideConvAvatarElName).prop('checked', enabledHideConvAvatar)
  $(switchHideConvNameElName).prop('checked', enabledHideConvName)
  $(switchHideThreadChatMessageElName).prop('checked', enabledHideThreadChatMessage)

  $(switchUseHotkeysElName).prop('checked', useHotkeys)
})

$(radioInputThemeElName).on('change', function () {
  const theme = $(this).val()

  // Set theme for popup
  ZaDarkUtils.setPageTheme(theme)

  // Set theme for Zalo tabs
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_THEME, { theme })
})

$(inputFontFamilyElName).keypress(async function (event) {
  const isEnter = Number(event.keyCode ? event.keyCode : event.which) - 1 === 12

  if (!isEnter) {
    return
  }

  const fontFamily = $(this).val()
  const success = await ZaDarkUtils.updateFontFamily(fontFamily)

  if (success) {
    ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.REFRESH_ZALO_TABS)
  } else {
    $(this).val('')
  }
})

$(selectFontSizeElName).on('change', function () {
  const fontSize = $(this).val()
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_FONT_SIZE, { fontSize })
})

$(selectTranslateTargetElName).on('change', function () {
  const translateTarget = $(this).val()
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_TRANSLATE_TARGET, { translateTarget })
})

$(switchHideLatestMessageElName).on('change', function () {
  const isEnabled = $(this).is(':checked')
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_HIDE_LATEST_MESSAGE, { isEnabled })
})

$(switchHideConvAvatarElName).on('change', function () {
  const isEnabled = $(this).is(':checked')
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_HIDE_CONV_AVATAR, { isEnabled })
})

$(switchHideConvNameElName).on('change', function () {
  const isEnabled = $(this).is(':checked')
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_HIDE_CONV_NAME, { isEnabled })
})

$(switchHideThreadChatMessageElName).on('change', function () {
  const isEnabled = $(this).is(':checked')
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_HIDE_THREAD_CHAT_MESSAGE, { isEnabled })
})

$(switchUseHotkeysElName).on('change', function () {
  const isEnabled = $(this).is(':checked')
  ZaDarkBrowser.sendMessage2ZaloTabs(MSG_ACTIONS.CHANGE_USE_HOTKEYS, { isEnabled })
})

const setStickerStatus = (message = '', state = '') => {
  const statusEl = document.querySelector(stickerStatusElName)
  if (!statusEl) return
  statusEl.textContent = message
  statusEl.setAttribute('data-state', state)
}

const setStickerBusy = (busy) => {
  stickerBusy = busy
  const panelEl = document.querySelector(stickerPanelElName)
  if (!panelEl) return

  panelEl.querySelectorAll('input, button').forEach((controlEl) => {
    controlEl.disabled = busy
  })
  panelEl.classList.toggle('zadark-sticker-panel--busy', busy)
  $(stickerDropzoneElName).attr('aria-disabled', busy ? 'true' : 'false')
}

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'))
  reader.readAsDataURL(file)
})

const uploadStickerFile = async (file) => {
  if (stickerBusy) return

  if (!file || !file.type || !file.type.startsWith('image/')) {
    setStickerStatus('Vui lòng chọn một tệp hình ảnh.', 'error')
    return
  }
  if (file.size > stickerMaxFileSize) {
    setStickerStatus('Dung lượng ảnh tối đa là 10 MiB.', 'error')
    return
  }

  setStickerBusy(true)
  setStickerStatus('Đang tải ảnh lên…', 'loading')

  try {
    const dataUrl = await readFileAsDataUrl(file)
    const result = await ZaDarkBrowser.sendMessage({
      action: '@ZaDark:Sticker:Upload',
      payload: { dataUrl, fileName: file.name }
    })

    if (!result || !result.ok || !result.photoUrl) {
      setStickerStatus((result && result.message) || 'Không thể tải ảnh lên.', 'error')
      return
    }

    $(stickerUrlInputElName).val(result.photoUrl)
    setStickerStatus('Đã tải ảnh. Kiểm tra URL rồi nhấn “Gửi sticker”.', 'success')
  } catch (error) {
    setStickerStatus(error.message || 'Không thể tải ảnh lên.', 'error')
  } finally {
    setStickerBusy(false)
  }
}

const isHttpsUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname
  } catch (_) {
    return false
  }
}

const sendSticker = async () => {
  if (stickerBusy) return

  const stickerUrl = $(stickerUrlInputElName).val().trim()
  const mode = $(stickerModeInputElName).filter(':checked').val()
  if (!isHttpsUrl(stickerUrl)) {
    setStickerStatus('Nhập một URL ảnh bắt đầu bằng https://.', 'error')
    $(stickerUrlInputElName).trigger('focus')
    return
  }

  setStickerBusy(true)
  setStickerStatus('Đang gửi sticker…', 'loading')
  try {
    const result = await ZaDarkBrowser.sendMessage({
      action: '@ZaDark:Sticker:SendInCurrentTab',
      payload: { stickerUrl, mode }
    })
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

const loadStickerPanel = () => {
  const dropzoneEl = document.querySelector(stickerDropzoneElName)
  const fileInputEl = document.querySelector(stickerFileInputElName)
  if (!dropzoneEl || !fileInputEl) return

  fileInputEl.addEventListener('change', () => {
    uploadStickerFile(fileInputEl.files[0])
    fileInputEl.value = ''
  })
  dropzoneEl.addEventListener('click', (event) => {
    if (event.target !== fileInputEl && !stickerBusy) fileInputEl.click()
  })
  dropzoneEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!stickerBusy) fileInputEl.click()
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
    if (!stickerBusy) uploadStickerFile(event.dataTransfer.files[0])
  })
  $(stickerUrlInputElName).on('keydown', (event) => {
    if (event.key === 'Enter') sendSticker()
  })
  $(stickerSendButtonElName).on('click', sendSticker)
}

loadStickerPanel()

const handleBlockingRuleChange = (elName, ruleId) => {
  return () => {
    const isChecked = $(elName).is(':checked')

    const payload = isChecked
      ? { enableRulesetIds: [ruleId] }
      : { disableRulesetIds: [ruleId] }

    ZaDarkBrowser.sendMessage({ action: MSG_ACTIONS.UPDATE_ENABLED_BLOCKING_RULE_IDS, payload })
  }
}

const loadBlocking = () => {
  const isEnabled = ZaDarkUtils.isSupportDeclarativeNetRequest()

  if (!isEnabled) {
    const disabledList = [switchBlockTypingElName, switchBlockSeenElName, switchBlockDeliveredElName]

    disabledList.forEach((elName) => {
      $(elName).parent().parent().addClass('zadark-switch--disabled')
    })

    return
  }

  ZaDarkBrowser.sendMessage({ action: MSG_ACTIONS.GET_ENABLED_BLOCKING_RULE_IDS }).then((ruleIds) => {
    if (!Array.isArray(ruleIds)) {
      return
    }

    $(switchBlockTypingElName).prop('checked', ruleIds.includes('rules_block_typing'))
    $(switchBlockSeenElName).prop('checked', ruleIds.includes('rules_block_seen'))
    $(switchBlockDeliveredElName).prop('checked', ruleIds.includes('rules_block_delivered'))
  })

  $(switchBlockTypingElName).on('change', handleBlockingRuleChange(switchBlockTypingElName, 'rules_block_typing'))
  $(switchBlockSeenElName).on('change', handleBlockingRuleChange(switchBlockSeenElName, 'rules_block_seen'))
  $(switchBlockDeliveredElName).on('change', handleBlockingRuleChange(switchBlockDeliveredElName, 'rules_block_delivered'))
}

loadBlocking()

$(btnScrollElName).on('click', () => {
  window.scrollTo({ left: 0, top: document.body.scrollHeight, behavior: 'smooth' })
})

const calcPopupScroll = () => {
  const scrolledFromTop = $(window).scrollTop()
  const scrollable = $(window).height() < $(document).height()

  if (!scrollable || scrolledFromTop >= 24) {
    $(btnScrollElName).fadeOut(150)
  } else {
    $(btnScrollElName).fadeIn(150)
  }
}

calcPopupScroll()

$(window).on('scroll', ZaDarkShared.debounce(calcPopupScroll, 150))
