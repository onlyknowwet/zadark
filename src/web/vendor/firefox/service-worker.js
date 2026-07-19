/*
  ZaDark – Zalo Dark Mode
  Firefox Extension
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

const sendMessageToZmenuTab = (tabId, message) => browser.tabs.sendMessage(tabId, message).catch(() => null)

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
  const settings = await browser.storage.sync.get({
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

  await browser.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds
  })
}

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    handleLoadRulesets().catch((error) => console.error('[ZaDark] Blocking rules initialization failed:', normalizeError(error, 'Unknown rules initialization failure.').message))
  }

  if (details.reason === 'update') {
    browser.storage.local.remove(['threadChatBg'])
    handleLoadRulesets().catch((error) => console.error('[ZaDark] Blocking rules initialization failed:', normalizeError(error, 'Unknown rules initialization failure.').message))
  }
})

browser.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    const { action, payload } = request || {}

    if (action === MSG_ACTIONS.SEND_STICKER_IN_CURRENT_TAB) {
      const invalid = validateSendPayload(payload)
      if (invalid) {
        console.error('[ZaDarkSticker] background error:', invalid)
        return Promise.resolve({ ok: false, message: invalid })
      }
      return browser.tabs.query({ active: true, currentWindow: true, url: 'https://chat.zalo.me/*' }).then((tabs) => {
        const tabCount = tabs.length
        console.debug('[ZaDarkSticker] background active tabs', { action, tabCount })
        if (tabCount !== 1 || typeof tabs[0].id !== 'number') return { ok: false, message: 'No active Zalo chat tab found. Open chat.zalo.me in the current window and try again.' }
        return browser.tabs.sendMessage(tabs[0].id, { action: '@ZaDark:Sticker:SendInTab', payload }).then(normalizeSendResult)
      }).then((result) => {
        console.debug('[ZaDarkSticker] background result', { action, ok: result.ok })
        if (!result.ok) console.error('[ZaDarkSticker] background error:', result.message)
        return result
      }).catch((error) => {
        const normalized = normalizeError(error, 'Could not contact the active Zalo chat tab. Reload it and try again.')
        console.error('[ZaDarkSticker] background error:', normalized.message)
        return { ok: false, message: normalized.message }
      })
    }

    if (action === MSG_ACTIONS.UPLOAD_STICKER) {
      return browser.tabs.query({ url: 'https://zmenu.zalo.me/*' })
        .then((tabs) => uploadWithCompatibleZmenuTab(tabs, payload))
        .catch((error) => {
          const result = { ok: false, message: normalizeError(error, 'Could not query zmenu tabs. Reload zmenu and try again.').message }
          console.error('[ZaDarkSticker] upload error:', result.message)
          return result
        })
    }

    if (action === MSG_ACTIONS.GET_ENABLED_BLOCKING_RULE_IDS) {
      return browser.declarativeNetRequest.getEnabledRulesets()
        .catch((error) => { throw normalizeError(error, 'Could not load blocking rules.') })
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

      return Promise.all([browser.storage.sync.set(settings), browser.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds,
        disableRulesetIds
      })]).then(() => true).catch((error) => { throw normalizeError(error, 'Could not update blocking rules.') })
    }

    return false
  }
)
