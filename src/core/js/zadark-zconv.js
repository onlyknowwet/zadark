(function () {
  // const log = console.log.bind(console, '[zadark-zconv]')

  const CONV_ID_KEYS = ['convId', 'conversationId', 'receiverId']
  const PROPS_CONTAINER_KEYS = ['conversation', 'conv', 'thread', 'item', 'data', 'props']
  const REACT_FIBER_PREFIXES = ['__reactFiber$', '__reactInternalInstance']
  const MAX_FIBER_NODES = 120
  const MAX_PROPS_NODES = 30

  function normalizeConvId (value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }

    if (typeof value !== 'string') {
      return null
    }

    const convId = value.trim()
    return convId || null
  }

  function getConvIdFromProps (initialProps) {
    if (!initialProps || typeof initialProps !== 'object') {
      return null
    }

    const visited = new WeakSet()
    const queue = [initialProps]
    let visitedCount = 0

    while (queue.length && visitedCount < MAX_PROPS_NODES) {
      const props = queue.shift()
      if (!props || typeof props !== 'object' || visited.has(props)) {
        continue
      }

      visited.add(props)
      visitedCount++

      for (const key of CONV_ID_KEYS) {
        const convId = normalizeConvId(props[key])
        if (convId) {
          return convId
        }
      }

      PROPS_CONTAINER_KEYS.forEach((key) => {
        const value = props[key]
        if (value && typeof value === 'object' && !visited.has(value)) {
          queue.push(value)
        }
      })
    }

    return null
  }

  function getReactValue (element, prefixes) {
    if (!element) {
      return null
    }

    const reactKey = Object.keys(element).find((key) => prefixes.some((prefix) => key.startsWith(prefix)))
    return reactKey ? element[reactKey] : null
  }

  function getConvIdFromFiber (initialFiber, allowFiberKey) {
    if (!initialFiber || typeof initialFiber !== 'object') {
      return null
    }

    const visited = new WeakSet()
    const queue = [initialFiber]
    let visitedCount = 0

    while (queue.length && visitedCount < MAX_FIBER_NODES) {
      const fiber = queue.shift()
      if (!fiber || typeof fiber !== 'object' || visited.has(fiber)) {
        continue
      }

      visited.add(fiber)
      visitedCount++

      const convId = getConvIdFromProps(fiber.memoizedProps) || getConvIdFromProps(fiber.pendingProps)
      if (convId) {
        return convId
      }

      if (allowFiberKey && fiber === initialFiber) {
        const keyConvId = normalizeConvId(fiber.key)
        if (keyConvId) {
          return keyConvId
        }
      }

      const relatedFiberKeys = ['return', 'child', 'sibling']
      relatedFiberKeys.forEach((key) => {
        const value = fiber[key]
        if (value && typeof value === 'object' && !visited.has(value)) {
          queue.push(value)
        }
      })
    }

    return null
  }

  function getConvIdFromElement (element, allowFiberKey) {
    let currentElement = element
    let ancestorCount = 0

    while (currentElement && ancestorCount < 6) {
      for (const key of CONV_ID_KEYS) {
        const attributeName = `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
        const convId = normalizeConvId(currentElement.getAttribute && currentElement.getAttribute(attributeName))
        if (convId) {
          return convId
        }
      }

      const props = getReactValue(currentElement, ['__reactProps$'])
      const propsConvId = getConvIdFromProps(props)
      if (propsConvId) {
        return propsConvId
      }

      const fiber = getReactValue(currentElement, REACT_FIBER_PREFIXES)
      const fiberConvId = getConvIdFromFiber(fiber, allowFiberKey)
      if (fiberConvId) {
        return fiberConvId
      }

      currentElement = currentElement.parentElement
      ancestorCount++
    }

    return null
  }

  /**
   * @param {string} convId
   */
  function fireConvIdChange (convId) {
    convId = normalizeConvId(convId)
    if (!convId) {
      return
    }

    const currentConvId = document.body.getAttribute('data-current-conv-id')
    if (convId === currentConvId) {
      return
    }

    document.body.setAttribute('data-current-conv-id', convId)

    document.dispatchEvent(new CustomEvent('@ZaDark:CONV_ID_CHANGE', { detail: convId }))
  }

  function getSelectedConversation () {
    const conversationList = document.getElementById('conversationListId')
    if (!conversationList) {
      return null
    }

    return conversationList.querySelector([
      '.msg-item.selected',
      '.msg-item.active',
      '.msg-item--selected',
      '.msg-item[aria-selected="true"]',
      '.conv-item.selected',
      '.selected',
      '[role="option"][aria-selected="true"]',
      '[aria-current="true"]',
      '[data-selected="true"]'
    ].join(','))
  }

  function detectCurrentConvId () {
    const chatView = document.getElementById('chatViewContainer')
    const chatViewConvId = getConvIdFromElement(chatView, false)
    if (chatViewConvId) {
      return chatViewConvId
    }

    const selectedConversation = getSelectedConversation()
    const selectedConvId = getConvIdFromElement(selectedConversation, true)
    if (selectedConvId) {
      return selectedConvId
    }

    const main = document.querySelector('#container > main')
    return getConvIdFromElement(main, false)
  }

  function refreshCurrentConvId () {
    const convId = detectCurrentConvId()
    if (convId) {
      fireConvIdChange(convId)
    }
  }

  function handleConversationClick (event) {
    const conversationList = document.getElementById('conversationListId')
    const target = event.target instanceof Element ? event.target : null
    if (!conversationList || !target || !conversationList.contains(target)) {
      return
    }

    const convItem = target.closest([
      '.msg-item',
      '.conv-item',
      '[role="option"]',
      '[data-conv-id]',
      '[data-conversation-id]',
      '[data-receiver-id]'
    ].join(','))
    if (!convItem || !conversationList.contains(convItem)) {
      return
    }

    const moreButton = target.closest('.conv-item-title__more')
    if (moreButton && convItem.contains(moreButton)) {
      return
    }

    const convId = getConvIdFromElement(convItem, true)
    if (convId) {
      fireConvIdChange(convId)
    }

    setTimeout(refreshCurrentConvId, 150)
  }

  function debounce (func, delay) {
    let timer
    return function () {
      clearTimeout(timer)
      timer = setTimeout(func, delay)
    }
  }

  let initialized = false
  function initialize () {
    if (initialized) {
      refreshCurrentConvId()
      return
    }

    initialized = true
    document.addEventListener('click', handleConversationClick)

    const handleFocus = debounce(refreshCurrentConvId, 200)
    if (document.body.classList.contains('zadark-pc')) {
      window.$zwindow.onVisibilityChange(handleFocus)
    } else {
      window.addEventListener('focus', handleFocus)
      document.addEventListener('visibilitychange', handleFocus)
    }

    refreshCurrentConvId()
  }

  const appPage = document.getElementById('app-page')
  if (appPage) {
    initialize()
    return
  }

  const app = document.getElementById('app')
  if (!app) {
    initialize()
    return
  }

  const observer = new MutationObserver((mutationsList) => {
    const appPageAdded = mutationsList.some((mutation) => Array.from(mutation.addedNodes).some((addedNode) => (
      addedNode.nodeType === Node.ELEMENT_NODE &&
      (addedNode.id === 'app-page' || (addedNode.querySelector && addedNode.querySelector('#app-page')))
    )))

    if (appPageAdded) {
      observer.disconnect()
      initialize()
    }
  })

  observer.observe(app, { subtree: true, childList: true })
})()
