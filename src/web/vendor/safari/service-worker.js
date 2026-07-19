/*
  ZaDark – Zalo Dark Mode
  Safari Extension
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

const validateSendPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return 'The popup supplied malformed sticker details.'
  if (payload.mode !== 'direct' && payload.mode !== 'group') return 'Sticker mode must be direct or group.'
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

const SETTINGS_RULE_KEYS = {
  rules_block_typing: 'enabledBlockTyping',
  rules_block_delivered: 'enabledBlockDelivered',
  rules_block_seen: 'enabledBlockSeen'
}

const UNINSTALL_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdLonVbx-IavimDRneKuUhtMox4vDbyu35tB6uzQG8FGJFbUg/viewform?usp=pp_url&entry.454875478=Safari'

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

  browser.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds
  })
}

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    browser.tabs.create({ url: 'https://zadark.com/web/safari' })
    browser.runtime.setUninstallURL(UNINSTALL_URL)
    handleLoadRulesets()
  }

  if (details.reason === 'update') {
    browser.runtime.setUninstallURL(UNINSTALL_URL)
    browser.storage.local.remove(['threadChatBg'])
    handleLoadRulesets()
  }
})

browser.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    const { action, payload } = request || {}

    if (action === MSG_ACTIONS.SEND_STICKER_IN_CURRENT_TAB) {
      const invalid = validateSendPayload(payload)
      if (invalid) return Promise.resolve({ ok: false, message: invalid })
      return browser.tabs.query({ active: true, currentWindow: true, url: 'https://chat.zalo.me/*' }).then((tabs) => {
        if (tabs.length !== 1 || typeof tabs[0].id !== 'number') return { ok: false, message: 'No active Zalo chat tab found. Open chat.zalo.me in the current window and try again.' }
        return browser.tabs.sendMessage(tabs[0].id, { action: '@ZaDark:Sticker:SendInTab', payload }).then(normalizeSendResult)
      }).catch(() => ({ ok: false, message: 'Could not contact the active Zalo chat tab. Reload it and try again.' }))
    }

    if (action === MSG_ACTIONS.UPLOAD_STICKER) {
      return browser.tabs.query({ url: 'https://zmenu.zalo.me/*' }).then((tabs) => {
        if (!tabs.length) return { ok: false, message: 'No zmenu tab found. Open zmenu.zalo.me, sign in, and try again.' }
        return browser.tabs.sendMessage(tabs[0].id, { action: '@ZaDark:Sticker:UploadInTab', payload }).then((result) => (
          result && typeof result.ok === 'boolean' ? result : malformedUploadResult
        ))
      }).catch(() => ({ ok: false, message: 'Could not contact zmenu. Reload the open zmenu tab and try again.' }))
    }

    if (action === MSG_ACTIONS.GET_ENABLED_BLOCKING_RULE_IDS) {
      browser.declarativeNetRequest.getEnabledRulesets().then((rulesetIds) => {
        sendResponse(rulesetIds)
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

      browser.storage.sync.set(settings)

      browser.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds,
        disableRulesetIds
      })
    }

    return true
  }
)
