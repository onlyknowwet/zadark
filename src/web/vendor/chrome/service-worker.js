/*
  ZaDark – Zalo Dark Mode
  Chrome Extension
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
const STICKER_UPLOAD_PROTOCOL = 'source-url-v2'
const STICKER_UPLOAD_CAPABILITIES = '@ZaDark:Sticker:UploadCapabilities'
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

const rankZmenuTabs = (tabs) => tabs.slice().sort((a, b) => {
  if (!!a.active !== !!b.active) return a.active ? -1 : 1
  return (b.lastAccessed || 0) - (a.lastAccessed || 0)
})

const sendMessageToZmenuTab = (tabId, message) => new Promise((resolve) => {
  chrome.tabs.sendMessage(tabId, message, (result) => {
    if (chrome.runtime.lastError) {
      resolve(null)
      return
    }
    resolve(result)
  })
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
    const capabilities = await sendMessageToZmenuTab(tab.id, { action: STICKER_UPLOAD_CAPABILITIES })
    if (capabilities && capabilities.protocol === STICKER_UPLOAD_PROTOCOL) {
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
  const result = await sendMessageToZmenuTab(selectedTab.id, { action: '@ZaDark:Sticker:UploadInTab', payload })
  const normalized = result === null
    ? { ok: false, message: 'Could not contact the selected compatible zmenu tab. Reload it and try again.' }
    : result && typeof result.ok === 'boolean' ? result : malformedUploadResult
  console.debug('[ZaDarkSticker] upload result', { ok: normalized.ok, message: normalized.message })
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
    chrome.tabs.create({ url: 'https://zadark.com/web/chrome' })
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
      chrome.tabs.query({ url: 'https://zmenu.zalo.me/*' }, (tabs) => {
        const error = chrome.runtime.lastError
        if (error) {
          const result = { ok: false, message: 'Could not query zmenu tabs. Reload zmenu and try again.' }
          console.error('[ZaDarkSticker] upload error:', result.message)
          sendResponse(result)
          return
        }
        uploadWithCompatibleZmenuTab(tabs, payload).then(sendResponse).catch((uploadError) => {
          const message = normalizeError(uploadError, 'Could not contact a compatible zmenu tab.').message
          console.error('[ZaDarkSticker] upload error:', message)
          sendResponse({ ok: false, message })
        })
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
