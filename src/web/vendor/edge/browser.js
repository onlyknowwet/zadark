/*
  ZaDark – Zalo Dark Mode
  Microsoft Edge Extension
  Made by Quaric

  ! This file must use VanillaJS
*/

(function (global) {
  const normalizeError = (error, fallback) => {
    if (error instanceof Error) return error
    if (typeof error === 'string' && error) return new Error(error)
    if (error && typeof error.message === 'string' && error.message) return new Error(error.message)
    return new Error(fallback)
  }

  const ZaDarkBrowser = {
    name: 'Edge',
    changelogURL: 'https://zadark.com/blog/changelog',

    initClassNames: () => {
      document.body.classList.add('zadark', 'zadark-web', 'zadark-edge')
    },

    getManifest: () => {
      return chrome.runtime.getManifest()
    },

    getURL: (path) => {
      return chrome.runtime.getURL(path)
    },

    getExtensionSettings: () => {
      return new Promise((resolve, reject) => {
        chrome.storage.sync.get({
          theme: 'dark',
          fontFamily: 'Open Sans',
          fontSize: '16',
          translateTarget: 'vi',

          enabledHideLatestMessage: false,
          enabledHideConvAvatar: false,
          enabledHideConvName: false,
          enabledHideThreadChatMessage: false,

          enabledBlockTyping: false,
          enabledBlockDelivered: false,
          enabledBlockSeen: false,

          useHotkeys: true,
          knownVersion: ''
        }, (items) => {
          resolve(items)
        })
      })
    },

    saveExtensionSettings: (items) => {
      return chrome.storage.sync.set(items)
    },

    // Data is stored locally and cleared when the extension is removed.
    // The storage limit is 10 MB (5 MB in Chrome 113 and earlier),
    // but can be increased by requesting the "unlimitedStorage" permission.
    // We recommend using storage.local to store larger amounts of data.
    // ? Ref: https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas
    getExtensionSettingsLocal: (keys = {}) => {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get({
          threadChatBg: '',
          ...keys
        }, (items) => {
          resolve(items)
        })
      })
    },
    saveExtensionSettingsLocal: (items) => {
      return chrome.storage.local.set(items)
    },
    /**
     * @param {string[]} items
     */
    removeExtensionSettingsLocal: (items) => {
      return chrome.storage.local.remove(items)
    },

    getZaloTabs: async () => {
      const tabs = await chrome.tabs.query({
        url: ['*://chat.zalo.me/*'],
        currentWindow: true
      })
      return tabs
    },

    sendMessage: (params) => {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(params, (result) => {
            const error = chrome.runtime.lastError
            if (error) {
              reject(normalizeError(error, 'Extension messaging failed.'))
              return
            }
            resolve(result)
          })
        } catch (error) {
          reject(normalizeError(error, 'Extension messaging failed.'))
        }
      })
    },

    sendMessage2Tab: async function (tabId, action, payload) {
      if (!tabId) {
        return
      }

      await Promise.resolve().then(() => chrome.tabs.sendMessage(tabId, {
        action,
        payload
      })).catch((error) => { throw normalizeError(error, 'Could not message a Zalo tab.') })
    },

    sendMessage2ZaloTabs: async function (action, payload) {
      try {
        const tabs = await this.getZaloTabs()
        const results = await Promise.allSettled(tabs.map((tab) => this.sendMessage2Tab(tab.id, action, payload)))
        results.forEach((result) => {
          if (result.status === 'rejected') console.error('[ZaDark] Zalo tab broadcast failed:', normalizeError(result.reason, 'Unknown tab messaging failure.').message)
        })
      } catch (error) {
        console.error('[ZaDark] Zalo tab lookup failed:', normalizeError(error, 'Unknown tab lookup failure.').message)
      }
    },

    addMessageListener: (callback) => {
      chrome.runtime.onMessage.addListener(callback)
    }
  }

  global.ZaDarkBrowser = ZaDarkBrowser
})(this)
