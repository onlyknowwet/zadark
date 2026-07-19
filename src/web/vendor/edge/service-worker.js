/*
  ZaDark – Zalo Dark Mode
  Microsoft Edge Extension
  Made by Quaric
*/

const MSG_ACTIONS = {
  GET_ENABLED_BLOCKING_RULE_IDS: '@ZaDark:GET_ENABLED_BLOCKING_RULE_IDS',
  UPDATE_ENABLED_BLOCKING_RULE_IDS: '@ZaDark:UPDATE_ENABLED_BLOCKING_RULE_IDS',
  UPLOAD_STICKER: '@ZaDark:Sticker:Upload',
  SEND_STICKER_IN_CURRENT_TAB: '@ZaDark:Sticker:SendInCurrentTab'
}

const RULE_IDS = ['rules_block_typing', 'rules_block_delivered', 'rules_block_seen']
const malformedUploadResult = { ok: false, message: 'The zmenu tab returned a malformed upload result.' }
const malformedSendResult = { ok: false, message: 'The Zalo chat tab returned a malformed send result.' }
const STICKER_UPLOAD_PROTOCOL = 'binary-upload-v3'
const STICKER_UPLOAD_CAPABILITIES = '@ZaDark:Sticker:UploadCapabilities:v3'
const MAX_STICKER_UPLOAD_SIZE = 10 * 1024 * 1024
const IMAGE_EXTENSIONS = { 'image/avif': 'avif', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp' }
const normalizeError = (error, fallback) => {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error) return new Error(error)
  if (error && typeof error.message === 'string' && error.message) return new Error(error.message)
  return new Error(fallback)
}

const validateSendPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return 'The popup supplied malformed sticker details.'
  if (typeof payload.stickerUrl !== 'string' || !payload.stickerUrl.trim()) return 'Sticker URL is required.'
  try {
    if (new URL(String(payload.stickerUrl || '')).protocol !== 'https:') return 'Sticker URL must use HTTPS.'
  } catch (_) {
    return 'Sticker URL must be a valid HTTPS URL.'
  }
  return null
}

const normalizeSendResult = (result) => result && typeof result.ok === 'boolean' && typeof result.message === 'string'
  ? { ok: result.ok, message: result.message }
  : malformedSendResult

const safeUploadFileName = (value, mimeType) => {
  let fileName = typeof value === 'string' ? value.trim().split(/[\\/]/).pop() : ''
  fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'sticker'
  const extension = IMAGE_EXTENSIONS[mimeType]
  if (extension && !/\.[a-zA-Z0-9]{1,8}$/.test(fileName)) fileName += `.${extension}`
  return fileName
}

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    const end = Math.min(offset + 32768, bytes.length)
    for (let index = offset; index < end; index++) binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

const prepareUploadPayload = async (payload) => {
  if (!payload || typeof payload !== 'object') throw new Error('Malformed sticker upload payload.')
  if (typeof payload.sourceUrl !== 'string') return { ...payload, sourceType: payload.sourceType || 'file' }
  let sourceUrl
  try { sourceUrl = new URL(payload.sourceUrl) } catch (_) { throw new Error('Sticker source URL must be a valid HTTPS URL.') }
  if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname) throw new Error('Sticker source URL must be a valid HTTPS URL.')
  console.debug('[ZaDarkSticker] background source download request', { sourceUrl: sourceUrl.href, credentials: 'omit' })
  const response = await fetch(sourceUrl.href, { credentials: 'omit' })
  const mimeType = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  const contentLength = response.headers.get('Content-Length')
  console.debug('[ZaDarkSticker] background source download response', { status: response.status, contentType: mimeType, contentLength })
  if (!response.ok) throw new Error(`Source image download failed: HTTP ${response.status}.`)
  if (!mimeType.startsWith('image/')) throw new Error('The source URL did not return an image Content-Type.')
  const buffer = await response.arrayBuffer()
  if (!buffer.byteLength) throw new Error('The source image is empty.')
  if (buffer.byteLength > MAX_STICKER_UPLOAD_SIZE) throw new Error('The source image must not exceed 10 MiB.')
  return {
    protocol: STICKER_UPLOAD_PROTOCOL,
    dataUrl: `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`,
    fileName: safeUploadFileName(payload.fileName, mimeType),
    sourceType: 'url'
  }
}

const rankZmenuTabs = (tabs) => tabs.slice().sort((a, b) => {
  if (!!a.active !== !!b.active) return a.active ? -1 : 1
  return (b.lastAccessed || 0) - (a.lastAccessed || 0)
})

const sendMessageToZmenuTab = (tabId, message) => new Promise((resolve) => {
  try {
    chrome.tabs.sendMessage(tabId, message, (result) => {
      const error = chrome.runtime.lastError
      if (error) {
        resolve({ ok: false, message: normalizeError(error, 'Could not message the zmenu tab.').message })
        return
      }
      resolve({ ok: true, result })
    })
  } catch (error) {
    resolve({ ok: false, message: normalizeError(error, 'Could not message the zmenu tab.').message })
  }
})

const queryZmenuTabs = () => new Promise((resolve) => {
  try {
    chrome.tabs.query({ url: 'https://zmenu.zalo.me/*' }, (tabs) => {
      const error = chrome.runtime.lastError
      if (error) {
        resolve({ ok: false, message: normalizeError(error, 'Could not query zmenu tabs.').message })
        return
      }
      resolve({ ok: true, tabs: Array.isArray(tabs) ? tabs : [] })
    })
  } catch (error) {
    resolve({ ok: false, message: normalizeError(error, 'Could not query zmenu tabs.').message })
  }
})

const uploadWithCompatibleZmenuTab = async (tabs, payload) => {
  const candidates = rankZmenuTabs(Array.isArray(tabs) ? tabs : [])
  console.debug('[ZaDarkSticker] upload candidates', { candidateCount: candidates.length })
  if (!candidates.length) {
    const result = { ok: false, message: 'No zmenu tab found. Open zmenu.zalo.me, sign in, and try again.' }
    console.debug('[ZaDarkSticker] upload result', result)
    return result
  }
  let selectedTab
  for (const tab of candidates) {
    if (typeof tab.id !== 'number') continue
    console.debug('[ZaDarkSticker] background -> zmenu capability request', { tabId: tab.id })
    const probe = await sendMessageToZmenuTab(tab.id, { action: STICKER_UPLOAD_CAPABILITIES })
    console.debug('[ZaDarkSticker] background <- zmenu capability response', {
      tabId: tab.id,
      protocol: probe.ok && probe.result && probe.result.protocol,
      error: probe.ok ? undefined : probe.message
    })
    if (probe.ok && probe.result && probe.result.protocol === STICKER_UPLOAD_PROTOCOL) {
      selectedTab = tab
      break
    }
  }
  if (!selectedTab) {
    const result = { ok: false, message: 'No compatible zmenu tab found. Close and reopen or reload all zmenu tabs after updating the extension.' }
    console.debug('[ZaDarkSticker] upload result', result)
    return result
  }
  console.debug('[ZaDarkSticker] upload selected tab', { tabId: selectedTab.id, protocol: STICKER_UPLOAD_PROTOCOL })
  const sourceType = payload.sourceType || (typeof payload.sourceUrl === 'string' ? 'url' : 'file')
  const requestLog = { tabId: selectedTab.id, protocol: payload.protocol, sourceType, fileName: payload.fileName }
  if (sourceType === 'url' && typeof payload.sourceUrl === 'string') requestLog.sourceUrl = payload.sourceUrl
  console.debug('[ZaDarkSticker] background -> zmenu upload request', requestLog)
  const delivery = await sendMessageToZmenuTab(selectedTab.id, { action: '@ZaDark:Sticker:UploadInTab:v3', payload })
  const normalized = !delivery.ok
    ? { ok: false, message: delivery.message }
    : delivery.result && typeof delivery.result.ok === 'boolean' ? delivery.result : malformedUploadResult
  console.debug('[ZaDarkSticker] background <- zmenu upload response', { tabId: selectedTab.id, ok: normalized.ok, message: normalized.message, photoUrl: normalized.photoUrl, uploadResponse: normalized.uploadResponse })
  return normalized
}

const SETTINGS_RULE_KEYS = {
  rules_block_typing: 'enabledBlockTyping',
  rules_block_delivered: 'enabledBlockDelivered',
  rules_block_seen: 'enabledBlockSeen'
}

const handleLoadRulesets = async () => {
  const settings = await chrome.storage.sync.get({
    enabledBlockTyping: false,
    enabledBlockDelivered: false,
    enabledBlockSeen: false
  })

  const enableRulesetIds = []
  const disableRulesetIds = []

  RULE_IDS.forEach((ruleId) => {
    const key = SETTINGS_RULE_KEYS[ruleId]

    if (!key) return

    if (settings[key]) {
      enableRulesetIds.push(ruleId)
    } else {
      disableRulesetIds.push(ruleId)
    }
  })

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds
  })
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://zadark.com/web/edge' })
    handleLoadRulesets().catch((error) => console.error('[ZaDark] Blocking rules initialization failed:', normalizeError(error, 'Unknown rules initialization failure.').message))
  }

  if (details.reason === 'update') {
    chrome.storage.local.remove(['threadChatBg'])
    handleLoadRulesets().catch((error) => console.error('[ZaDark] Blocking rules initialization failed:', normalizeError(error, 'Unknown rules initialization failure.').message))
  }
})

chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    const { action, payload } = request || {}

    if (action === MSG_ACTIONS.SEND_STICKER_IN_CURRENT_TAB) {
      const invalid = validateSendPayload(payload)
      if (invalid) {
        console.error('[ZaDarkSticker] background error:', invalid)
        sendResponse({ ok: false, message: invalid })
        return true
      }
      chrome.tabs.query({ active: true, currentWindow: true, url: 'https://chat.zalo.me/*' }, (tabs) => {
        const queryError = chrome.runtime.lastError
        const tabCount = Array.isArray(tabs) ? tabs.length : 0
        console.debug('[ZaDarkSticker] background active tabs', { action, tabCount })
        if (queryError || tabCount !== 1 || typeof tabs[0].id !== 'number') {
          const message = queryError
            ? normalizeError(queryError.message, 'Could not query the active Zalo chat tab.').message
            : 'No active Zalo chat tab found. Open chat.zalo.me in the current window and try again.'
          console.error('[ZaDarkSticker] background error:', message)
          sendResponse({ ok: false, message })
          return
        }
        chrome.tabs.sendMessage(tabs[0].id, { action: '@ZaDark:Sticker:SendInTab', payload }, (result) => {
          const error = chrome.runtime.lastError
          const normalized = error
            ? { ok: false, message: 'Could not contact the active Zalo chat tab. Reload it and try again.' }
            : normalizeSendResult(result)
          console.debug('[ZaDarkSticker] background result', { action, ok: normalized.ok })
          if (!normalized.ok) console.error('[ZaDarkSticker] background error:', normalized.message)
          sendResponse(normalized)
        })
      })
      return true
    }

    if (action === MSG_ACTIONS.UPLOAD_STICKER) {
      const sourceType = payload && typeof payload.sourceUrl === 'string' ? 'url' : 'file'
      console.debug('[ZaDarkSticker] background upload request', { protocol: payload && payload.protocol, sourceType })
      prepareUploadPayload(payload).then((preparedPayload) => {
        console.debug('[ZaDarkSticker] background prepared upload payload', { protocol: preparedPayload.protocol, sourceType: preparedPayload.sourceType, fileName: preparedPayload.fileName })
        return queryZmenuTabs().then((queryResult) => ({ preparedPayload, queryResult }))
      }).then(({ preparedPayload, queryResult }) => {
        console.debug('[ZaDarkSticker] background zmenu tabs response', {
          ok: queryResult.ok,
          candidateCount: queryResult.tabs ? queryResult.tabs.length : 0,
          message: queryResult.message
        })
        if (!queryResult.ok) return { ok: false, message: queryResult.message }
        return uploadWithCompatibleZmenuTab(queryResult.tabs, preparedPayload)
      }).then((result) => {
        console.debug('[ZaDarkSticker] background upload response', { ok: result.ok, message: result.message, photoUrl: result.photoUrl, uploadResponse: result.uploadResponse })
        sendResponse(result)
      }).catch((uploadError) => {
          const message = normalizeError(uploadError, 'Could not contact a compatible zmenu tab.').message
          console.error('[ZaDarkSticker] upload error:', message)
          sendResponse({ ok: false, message })
      })
      return true
    }

    if (action === MSG_ACTIONS.GET_ENABLED_BLOCKING_RULE_IDS) {
      chrome.declarativeNetRequest.getEnabledRulesets().then((rulesetIds) => {
        sendResponse(rulesetIds)
      }).catch((error) => {
        console.error('[ZaDark] Blocking rule load failed:', normalizeError(error, 'Unknown blocking rule load failure.').message)
        sendResponse([])
      })
    }

    if (action === MSG_ACTIONS.UPDATE_ENABLED_BLOCKING_RULE_IDS) {
      const { enableRulesetIds, disableRulesetIds } = payload

      const settings = {}

      Array.isArray(enableRulesetIds) && enableRulesetIds.forEach((ruleId) => {
        const key = SETTINGS_RULE_KEYS[ruleId]
        if (key) settings[key] = true
      })

      Array.isArray(disableRulesetIds) && disableRulesetIds.forEach((ruleId) => {
        const key = SETTINGS_RULE_KEYS[ruleId]
        if (key) settings[key] = false
      })

      Promise.all([chrome.storage.sync.set(settings), chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds,
        disableRulesetIds
      })]).then(() => sendResponse(true)).catch((error) => {
        console.error('[ZaDark] Blocking rule update failed:', normalizeError(error, 'Unknown blocking rule update failure.').message)
        sendResponse(false)
      })
    }

    return true
  }
)
