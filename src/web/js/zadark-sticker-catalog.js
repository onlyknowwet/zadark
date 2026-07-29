(function () {
  'use strict'

  const CATALOG_URL = 'https://vubaongoc1404.github.io/stickers.json'
  const SEND_ACTION = '@ZaDark:Sticker:SendInCurrentTab'
  const RECENT_KEY = 'zadarkStickerRecent:v1'
  const RECENT_LIMIT = 16
  const MAX_STICKERS = 240
  let catalogPromise = null

  const isHttpsUrl = value => {
    try {
      const url = new URL(String(value || '').trim())
      return url.protocol === 'https:' && !!url.hostname ? url.href : ''
    } catch (error) {
      return ''
    }
  }
  const safeId = (value, fallback = 'category') => String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || fallback
  const pick = (source, keys) => {
    if (!source || typeof source !== 'object') return ''
    for (const key of keys) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
    return ''
  }
  const readList = value => Array.isArray(value) ? value : []
  const toTags = value => Array.isArray(value) ? value.map(String).filter(Boolean) : typeof value === 'string' ? value.split(',').map(value => value.trim()).filter(Boolean) : []
  const toDimension = value => {
    const dimension = Number(value)
    return Number.isFinite(dimension) && dimension > 0 ? Math.max(1, Math.min(4096, Math.round(dimension))) : 512
  }
  const stickerKey = sticker => `${(sticker && sticker.stickerUrl) || ''}|${(sticker && sticker.thumbUrl) || ''}`
  const normalizeSticker = (raw, pack = {}, index = 0) => {
    if (typeof raw === 'string') {
      raw = {
        stickerUrl: raw
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const stickerUrl = isHttpsUrl(pick(raw, ['stickerUrl', 'photoUrl', 'url', 'src', 'imageUrl', 'image', 'hdUrl', 'oriUrl']))
    if (!stickerUrl) return null
    const thumbUrl = isHttpsUrl(pick(raw, ['thumbUrl', 'thumbnailUrl', 'thumbnail', 'thumb', 'previewUrl', 'preview', 'cover'])) || stickerUrl
    const packId = pick(pack, ['id', 'slug', 'name', 'title'])
    const id = pick(raw, ['id', 'key', 'slug']) || `${packId || 'sticker'}-${index + 1}`
    const name = pick(raw, ['name', 'title', 'label', 'alt']) || id || 'Sticker'
    return {
      id: id.slice(0, 96),
      name: name.slice(0, 96),
      packName: pick(pack, ['name', 'title', 'label']).slice(0, 96),
      stickerUrl,
      thumbUrl,
      width: toDimension(pick(raw, ['width', 'w', 'thumbWidth'])),
      height: toDimension(pick(raw, ['height', 'h', 'thumbHeight'])),
      tags: toTags(raw.tags || raw.keywords)
    }
  }
  const normalizeCategory = (raw = {}, fallbackId = 'stickers', fallbackName = 'Stickers') => {
    const id = safeId(pick(raw, ['id', 'slug', 'key', 'name', 'title', 'label']) || fallbackId, fallbackId)
    const name = (pick(raw, ['name', 'title', 'label']) || fallbackName).slice(0, 96)
    const iconUrl = isHttpsUrl(pick(raw, ['iconUrl', 'icon', 'coverUrl', 'cover', 'thumbUrl', 'thumbnailUrl']))
    return {
      id,
      name,
      iconUrl,
      stickers: []
    }
  }
  const normalizeCatalog = data => {
    const categories = []
    const addCategory = (rawCategory, fallbackId, fallbackName, rawItems) => {
      const category = normalizeCategory(rawCategory, fallbackId, fallbackName)
      readList(rawItems).forEach((raw, index) => {
        const sticker = normalizeSticker(raw, category, index)
        sticker && category.stickers.push(sticker)
      })
      category.stickers.length && categories.push(category)
    }
    if (Array.isArray(data)) addCategory({}, 'stickers', 'Stickers', data); else if (data && typeof data === 'object') {
      const topItems = readList(data.stickers).concat(readList(data.items))
      topItems.length && addCategory(data, 'stickers', pick(data, ['name', 'title', 'label']) || 'Stickers', topItems)
      readList(data.categories).forEach((category, index) => addCategory(category, `category-${index + 1}`, pick(category, ['name', 'title', 'label']) || `Category ${index + 1}`, category && (category.stickers || category.items)))
      readList(data.packs).forEach((pack, index) => addCategory(pack, `pack-${index + 1}`, pick(pack, ['name', 'title', 'label']) || `Pack ${index + 1}`, pack && (pack.stickers || pack.items)))
      if (!categories.length) {
        const mapped = []
        Object.entries(data).forEach(([key, value]) => {
          if (typeof value === 'string') {
            mapped.push({
              id: key,
              name: key,
              stickerUrl: value
            })
          } else {
            value && typeof value === 'object' && !Array.isArray(value) && mapped.push({
              id: value.id || key,
              name: value.name || key,
              ...value
            })
          }
        })
        mapped.length && addCategory({}, 'stickers', 'Stickers', mapped)
      }
    }
    const seen = new Set()
    const stickers = []
    categories.forEach(category => {
      category.stickers = category.stickers.filter(sticker => {
        if (stickers.length >= MAX_STICKERS) return false
        const key = stickerKey(sticker)
        if (seen.has(key)) return false
        seen.add(key)
        stickers.push(sticker)
        return true
      })
      if (!category.iconUrl) category.iconUrl = (category.stickers[0] && (category.stickers[0].thumbUrl || category.stickers[0].stickerUrl)) || ''
    })
    return {
      categories: categories.filter(category => category.stickers.length),
      stickers
    }
  }
  const loadCatalog = (force = false) => {
    if (force) catalogPromise = null
    if (!catalogPromise) {
      catalogPromise = fetch(CATALOG_URL, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      }).then(response => {
        if (!response.ok) throw new Error(`Sticker list request failed (${response.status}).`)
        return response.json()
      }).then(normalizeCatalog)
    }
    return catalogPromise
  }
  const readRecent = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
      return Array.isArray(raw) ? raw.map(item => normalizeSticker(item)).filter(Boolean).slice(0, RECENT_LIMIT) : []
    } catch (error) {
      return []
    }
  }
  const rememberRecent = sticker => {
    try {
      const recent = [sticker, ...readRecent().filter(item => stickerKey(item) !== stickerKey(sticker))].slice(0, RECENT_LIMIT).map(item => ({
        id: item.id,
        name: item.name,
        packName: item.packName,
        stickerUrl: item.stickerUrl,
        thumbUrl: item.thumbUrl,
        width: item.width,
        height: item.height,
        tags: item.tags || []
      }))
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
    } catch (error) {}
  }
  const setStatus = (element, text = '', state = '') => {
    if (element) {
      element.textContent = text
      element.setAttribute('data-state', state)
    }
  }
  const sendRuntimeMessage = message => new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    try {
      typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage
        ? browser.runtime.sendMessage(message).then(finish, error => finish({
            ok: false,
            message: error && error.message ? error.message : 'Could not contact the extension service worker.'
          }))
        : chrome.runtime.sendMessage(message, response => {
          const error = chrome.runtime.lastError
          finish(error
            ? {
                ok: false,
                message: error.message || 'Could not contact the extension service worker.'
              }
            : response)
        })
    } catch (error) {
      finish({
        ok: false,
        message: error && error.message ? error.message : 'Could not send the sticker.'
      })
    }
  })
  const sendDirect = (mode, sticker) => {
    const payload = {
      stickerUrl: sticker.stickerUrl,
      thumbUrl: sticker.thumbUrl || sticker.stickerUrl,
      width: sticker.width || 512,
      height: sticker.height || 512
    }
    return mode === 'chat' && window.ZaDarkSticker && typeof window.ZaDarkSticker.send === 'function'
      ? window.ZaDarkSticker.send(payload)
      : sendRuntimeMessage({
        action: SEND_ACTION,
        payload
      })
  }
  const sendCatalogSticker = async (root, sendButton, statusElement, mode, sticker) => {
    if (!sticker || root.dataset.busy === 'true') return
    setCatalogBusy(root, true)
    if (sendButton) sendButton.disabled = true
    root.querySelectorAll('.zadark-sticker-catalog__item').forEach(item => {
      item.dataset.sending = 'false'
      item.setAttribute('aria-selected', 'false')
    })
    const currentButton = root.querySelector(`.zadark-sticker-catalog__item[data-index="${root._stickers.indexOf(sticker)}"]`)
    if (currentButton) {
      currentButton.dataset.sending = 'true'
      currentButton.setAttribute('aria-selected', 'true')
    }
    setStatus(statusElement, 'Sending sticker...', 'loading')
    try {
      const result = await sendDirect(mode, sticker)
      if (!result || !result.ok) {
        setStatus(statusElement, (result && result.message) || 'Could not send sticker.', 'error')
        return
      }
      rememberRecent(sticker)
      root._catalog && renderCatalog(root, root._catalog)
      setStatus(statusElement)
    } catch (error) {
      setStatus(statusElement, error && error.message ? error.message : 'Could not send sticker.', 'error')
    } finally {
      if (sendButton) sendButton.disabled = false
      setCatalogBusy(root, false)
    }
  }
  const ensureStyles = () => {
    if (document.getElementById('zadark-sticker-catalog-style')) return
    const style = document.createElement('style')
    style.id = 'zadark-sticker-catalog-style'
    style.textContent = '.zadark-sticker-catalog{margin:10px 0;padding:0;border:0;border-radius:0;background:transparent;color:var(--zadark-neutral-base,var(--text-primary,#1f2937));overflow:hidden}.zadark-sticker-catalog__bar{display:flex;align-items:center;gap:8px;padding:10px 10px 6px}.zadark-sticker-catalog__title{flex:1;min-width:0;font-size:13px;font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.zadark-sticker-catalog__refresh{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid var(--zadark-border-base,var(--border,#d9dee7));border-radius:6px;background:var(--zadark-white-300,var(--layer-background,#fff));color:var(--zadark-neutral-500,var(--text-secondary,#667085));cursor:pointer}.zadark-sticker-catalog__refresh:hover,.zadark-sticker-catalog__refresh:focus-visible{color:var(--zadark-blue-base,var(--brand-primary,#0068ff));outline:none}.zadark-sticker-catalog__viewport{max-height:314px;overflow:auto;padding:0 10px 10px;scroll-behavior:smooth}.zadark-sticker-catalog__section{scroll-margin-top:4px}.zadark-sticker-catalog__section-title{margin:8px 0 9px;color:var(--zadark-neutral-base,var(--text-primary,#1f2937));font-size:18px;font-weight:700;line-height:24px}.zadark-sticker-catalog__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:8px}.zadark-sticker-catalog__item{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;min-width:0;padding:6px;border:1px solid transparent;border-radius:7px;background:transparent;cursor:pointer}.zadark-sticker-catalog__item:hover,.zadark-sticker-catalog__item:focus-visible{border-color:var(--zadark-blue-base,var(--brand-primary,#0068ff));background:var(--zadark-white-300,var(--layer-background,#fff));outline:none}.zadark-sticker-catalog__item[aria-selected=true]{border-color:var(--zadark-blue-base,var(--brand-primary,#0068ff));box-shadow:0 0 0 1px var(--zadark-blue-base,var(--brand-primary,#0068ff)) inset}.zadark-sticker-catalog__item[data-sending=true]::after{content:"";position:absolute;inset:5px;border-radius:5px;background:rgba(0,0,0,.08)}.zadark-sticker-catalog__item:disabled{opacity:.72;cursor:wait}.zadark-sticker-catalog__item img{display:block;width:100%;height:100%;object-fit:contain}.zadark-sticker-catalog__empty{min-height:96px;display:flex;align-items:center;padding:0 10px 10px;color:var(--zadark-neutral-500,var(--text-secondary,#667085));font-size:12px;line-height:16px}.zadark-sticker-catalog__nav{display:flex;align-items:center;gap:6px;min-height:54px;padding:6px 8px;border-top:1px solid var(--zadark-border-base,var(--border,#d9dee7));background:var(--zadark-white-300,var(--layer-background,#fff));overflow-x:auto}.zadark-sticker-catalog__nav-button{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:42px;height:42px;padding:4px;border:0;border-radius:6px;background:transparent;color:var(--zadark-neutral-500,var(--text-secondary,#667085));cursor:pointer}.zadark-sticker-catalog__nav-button:hover,.zadark-sticker-catalog__nav-button:focus-visible{background:var(--zadark-grey-600,var(--layer-background-hover,#f4f5f7));outline:none}.zadark-sticker-catalog__nav-button[aria-current=true]{color:var(--zadark-blue-base,var(--brand-primary,#0068ff))}.zadark-sticker-catalog__nav-button[aria-current=true]::after{content:"";position:absolute;left:4px;right:4px;bottom:-6px;height:2px;border-radius:2px;background:var(--zadark-blue-base,var(--brand-primary,#0068ff))}.zadark-sticker-catalog__nav-button img{display:block;width:34px;height:34px;object-fit:contain}.zadark-sticker-catalog__nav-button svg{width:24px;height:24px}.zadark-sticker-catalog[data-busy=true] .zadark-sticker-catalog__refresh{cursor:wait;opacity:.65}.zadark-sticker-manual{margin-top:8px;border-top:1px solid var(--zadark-border-light,var(--border-subtle,#edf0f5));color:var(--zadark-neutral-500,var(--text-secondary,#667085))}.zadark-sticker-manual summary{display:flex;align-items:center;min-height:28px;cursor:pointer;font-size:12px;line-height:16px;list-style:none;user-select:none}.zadark-sticker-manual summary::-webkit-details-marker{display:none}.zadark-sticker-manual summary::after{content:"";width:7px;height:7px;margin-left:auto;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);transition:transform .15s ease}.zadark-sticker-manual[open] summary::after{transform:rotate(-135deg)}.zadark-sticker-manual__body{padding:2px 0 4px}.zadark-sticker-manual .zadark-sticker-dropzone{min-height:92px}.zadark-sticker-manual .zadark-sticker-send{margin-top:8px}#zadark-sticker-toolbar-popover{width:min(340px,calc(100vw - 24px));grid-template-columns:1fr;gap:0;padding:0;overflow:hidden}#zadark-sticker-toolbar-popover .zadark-sticker-catalog{position:relative;grid-column:1/-1;margin:0;border:0;border-radius:0;background:transparent}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__bar{position:absolute;top:8px;right:10px;z-index:2;padding:0}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__title{display:none}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__refresh{width:28px;height:28px;border-radius:6px;background:var(--zadark-white-400,var(--layer-background-hover,rgba(255,255,255,.05)))}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__viewport{max-height:230px;padding:12px 12px 12px}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__section-title{font-size:15px;line-height:20px;margin:0 36px 10px 0;font-weight:700}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__section:not(:first-child) .zadark-sticker-catalog__section-title{margin-top:14px}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__grid{grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:9px 8px}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__item{border-radius:6px;padding:0;border-color:transparent;background:transparent}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__item:hover,#zadark-sticker-toolbar-popover .zadark-sticker-catalog__item:focus-visible{background:var(--zadark-white-400,var(--layer-background-hover,rgba(255,255,255,.05)))}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__nav{min-height:42px;padding:4px 8px;border-top:1px solid var(--zadark-border-base,var(--border,#d9dee7));background:var(--zadark-white-300,var(--layer-background,#fff))}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__nav-button{width:34px;height:34px;border-radius:5px}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__nav-button img{width:28px;height:28px}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__nav-button svg{width:22px;height:22px}#zadark-sticker-toolbar-popover .zadark-sticker-catalog__nav-button[aria-current=true]::after{bottom:-4px;left:5px;right:5px}#zadark-sticker-toolbar-popover .zadark-sticker-manual{grid-column:1/-1;margin:0;padding:0 12px 8px;border-top:1px solid var(--zadark-border-light,var(--border-subtle,#edf0f5))}#zadark-sticker-toolbar-popover .zadark-sticker-manual summary{min-height:38px;font-size:12px;line-height:16px}#zadark-sticker-toolbar-popover .zadark-sticker-toolbar-popover__send{width:100%;margin-top:8px}#zadark-sticker-toolbar-popover .zadark-sticker-toolbar-popover__status{grid-column:1/-1;min-height:0;padding:0 12px 8px}'
    document.head.appendChild(style)
  }
  const setCatalogBusy = (root, busy) => {
    root.dataset.busy = busy ? 'true' : 'false'
    root.querySelectorAll('.zadark-sticker-catalog__item').forEach(button => {
      button.disabled = busy
    })
  }
  const setActiveNav = (root, categoryId) => {
    root.querySelectorAll('.zadark-sticker-catalog__nav-button').forEach(button => button.setAttribute('aria-current', button.dataset.target === categoryId ? 'true' : 'false'))
  }
  const buildRecentCategory = catalog => {
    const byKey = new Map((catalog.stickers || []).map(sticker => [stickerKey(sticker), sticker]))
    const stickers = readRecent().map(sticker => byKey.get(stickerKey(sticker)) || sticker).filter(Boolean).slice(0, RECENT_LIMIT)
    return stickers.length
      ? {
          id: 'recent',
          name: 'Recent',
          iconType: 'recent',
          stickers
        }
      : null
  }
  const appendStickerButton = (grid, root, sticker) => {
    const key = stickerKey(sticker)
    let index = root._stickerKeyMap.get(key)
    if (typeof index !== 'number') {
      index = root._stickers.length
      root._stickers.push(sticker)
      root._stickerKeyMap.set(key, index)
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'zadark-sticker-catalog__item'
    button.dataset.index = String(index)
    button.title = sticker.packName ? `${sticker.name} - ${sticker.packName}` : sticker.name
    button.setAttribute('aria-label', button.title)
    button.setAttribute('aria-selected', 'false')
    const image = document.createElement('img')
    image.src = sticker.thumbUrl || sticker.stickerUrl
    image.alt = sticker.name
    image.loading = 'lazy'
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    button.appendChild(image)
    grid.appendChild(button)
  }
  const appendNavButton = (nav, category, isActive) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'zadark-sticker-catalog__nav-button'
    button.dataset.target = category.id
    button.title = category.name
    button.setAttribute('aria-label', category.name)
    button.setAttribute('aria-current', isActive ? 'true' : 'false')
    if (category.iconType === 'recent') button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; else if (category.iconUrl) {
      const image = document.createElement('img')
      image.src = category.iconUrl
      image.alt = ''
      image.loading = 'lazy'
      image.decoding = 'async'
      image.referrerPolicy = 'no-referrer'
      button.appendChild(image)
    } else button.textContent = category.name.slice(0, 1).toUpperCase()
    nav.appendChild(button)
  }
  const renderCatalog = (root, catalog) => {
    const viewport = root.querySelector('.zadark-sticker-catalog__viewport')
    const sections = root.querySelector('.zadark-sticker-catalog__sections')
    const nav = root.querySelector('.zadark-sticker-catalog__nav')
    viewport.hidden = false
    nav.hidden = false
    sections.textContent = ''
    nav.textContent = ''
    root._catalog = catalog
    root._stickers = []
    root._stickerKeyMap = new Map()
    root._selected = null
    const categories = [buildRecentCategory(catalog), ...catalog.categories].filter(Boolean)
    if (!categories.length) {
      viewport.hidden = false
      nav.hidden = true
      const empty = document.createElement('div')
      empty.className = 'zadark-sticker-catalog__empty'
      empty.textContent = 'No stickers found in stickers.json.'
      sections.appendChild(empty)
      return
    }
    categories.forEach((category, categoryIndex) => {
      const section = document.createElement('section')
      section.className = 'zadark-sticker-catalog__section'
      section.dataset.categoryId = category.id
      const title = document.createElement('h3')
      title.className = 'zadark-sticker-catalog__section-title'
      title.textContent = category.name
      const grid = document.createElement('div')
      grid.className = 'zadark-sticker-catalog__grid'
      category.stickers.forEach(sticker => appendStickerButton(grid, root, sticker))
      section.appendChild(title)
      section.appendChild(grid)
      sections.appendChild(section)
      appendNavButton(nav, category, categoryIndex === 0)
    })
    const first = categories[0]
    first && setActiveNav(root, first.id)
  }
  const loadInto = async (root, force = false) => {
    const viewport = root.querySelector('.zadark-sticker-catalog__viewport')
    const sections = root.querySelector('.zadark-sticker-catalog__sections')
    const nav = root.querySelector('.zadark-sticker-catalog__nav')
    setCatalogBusy(root, true)
    viewport.hidden = false
    nav.hidden = true
    sections.textContent = ''
    const loading = document.createElement('div')
    loading.className = 'zadark-sticker-catalog__empty'
    loading.textContent = 'Loading stickers...'
    sections.appendChild(loading)
    try {
      renderCatalog(root, await loadCatalog(force))
    } catch (error) {
      viewport.hidden = false
      nav.hidden = true
      sections.textContent = ''
      const empty = document.createElement('div')
      empty.className = 'zadark-sticker-catalog__empty'
      empty.textContent = error && error.message ? error.message : 'Could not load stickers.json.'
      sections.appendChild(empty)
    } finally {
      setCatalogBusy(root, false)
    }
  }
  const createCatalog = onSelect => {
    ensureStyles()
    const root = document.createElement('div')
    root.className = 'zadark-sticker-catalog'
    root.innerHTML = '<div class="zadark-sticker-catalog__bar"><span class="zadark-sticker-catalog__title">Click a sticker to send</span><button type="button" class="zadark-sticker-catalog__refresh" title="Reload stickers" aria-label="Reload stickers"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 6v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 18v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 11a7 7 0 0 0-12-4l-3 3M5 13a7 7 0 0 0 12 4l3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><div class="zadark-sticker-catalog__viewport"><div class="zadark-sticker-catalog__sections"></div></div><div class="zadark-sticker-catalog__nav" aria-label="Sticker categories"></div>'
    const viewport = root.querySelector('.zadark-sticker-catalog__viewport')
    root.querySelector('.zadark-sticker-catalog__refresh').addEventListener('click', () => loadInto(root, true))
    root.addEventListener('click', event => {
      const navButton = event.target.closest('.zadark-sticker-catalog__nav-button')
      if (navButton) {
        const section = root.querySelector(`.zadark-sticker-catalog__section[data-category-id="${navButton.dataset.target}"]`)
        if (section) {
          section.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          })
          setActiveNav(root, navButton.dataset.target)
        }
        return
      }
      const button = event.target.closest('.zadark-sticker-catalog__item')
      if (!button || button.disabled) return
      const sticker = root._stickers && root._stickers[Number(button.dataset.index)]
      if (!sticker) return
      root._selected = sticker
      root.querySelectorAll('.zadark-sticker-catalog__item').forEach(item => item.setAttribute('aria-selected', item === button ? 'true' : 'false'))
      onSelect(sticker, root)
    })
    viewport.addEventListener('scroll', () => {
      let active = ''
      root.querySelectorAll('.zadark-sticker-catalog__section').forEach(section => {
        section.offsetTop <= viewport.scrollTop + 18 && (active = section.dataset.categoryId)
      })
      active && setActiveNav(root, active)
    }, {
      passive: true
    })
    loadInto(root)
    return root
  }
  const clearSelection = root => {
    root._selected = null
    root.querySelectorAll('.zadark-sticker-catalog__item').forEach(item => item.setAttribute('aria-selected', 'false'))
  }
  const bindDirectSend = options => {
    const { root, urlInput, thumbInput, sendButton, statusElement, mode } = options
    const clearIfChanged = () => {
      root._selected && urlInput.value.trim() !== root._selected.stickerUrl && clearSelection(root)
    }
    const directSend = async event => {
      const sticker = root._selected
      if (!sticker) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setCatalogBusy(root, true)
      sendButton.disabled = true
      setStatus(statusElement, 'Sending pre-uploaded sticker...', 'loading')
      try {
        const result = await sendDirect(mode, sticker)
        if (!result || !result.ok) {
          setStatus(statusElement, (result && result.message) || 'Could not send sticker.', 'error')
          return
        }
        rememberRecent(sticker)
        root._catalog && renderCatalog(root, root._catalog)
        setStatus(statusElement)
      } catch (error) {
        setStatus(statusElement, error && error.message ? error.message : 'Could not send sticker.', 'error')
      } finally {
        sendButton.disabled = false
        setCatalogBusy(root, false)
      }
    }
    urlInput.addEventListener('input', clearIfChanged)
    if (thumbInput) thumbInput.addEventListener('input', () => root._selected && clearSelection(root));
    [urlInput, thumbInput].filter(Boolean).forEach(input => input.addEventListener('keydown', event => {
      event.key === 'Enter' && root._selected && directSend(event)
    }, true))
    sendButton.addEventListener('click', directSend, true)
  }
  const moveManualControls = config => {
    const anchor = document.getElementById(config.anchorId)
    if (!anchor || anchor.dataset.zadarkStickerManualMoved) return
    const urlInput = document.getElementById(config.urlId)
    const thumbInput = document.getElementById(config.thumbId)
    const sendButton = document.getElementById(config.sendId)
    if (!urlInput || !thumbInput || !sendButton) return
    const urlField = urlInput.closest(config.fieldSelector)
    const thumbField = thumbInput.closest(config.fieldSelector)
    const note = config.noteSelector ? anchor.parentElement.querySelector(config.noteSelector) : null
    const details = document.createElement('details')
    details.className = 'zadark-sticker-manual'
    details.innerHTML = '<summary>Upload file or paste URL</summary><div class="zadark-sticker-manual__body"></div>'
    const body = details.querySelector('.zadark-sticker-manual__body')
    anchor.parentNode.insertBefore(details, sendButton.nextSibling)
    body.appendChild(anchor)
    urlField && body.appendChild(urlField)
    thumbField && body.appendChild(thumbField)
    note && body.appendChild(note)
    body.appendChild(sendButton)
    anchor.dataset.zadarkStickerManualMoved = 'true'
  }
  const moveToolbarManualControls = (popover, urlInput, thumbInput, sendButton, statusElement) => {
    if (!popover || popover.dataset.zadarkStickerManualMoved) return
    const urlField = urlInput.closest('.zadark-sticker-toolbar-popover__field')
    const thumbField = thumbInput.closest('.zadark-sticker-toolbar-popover__field')
    if (!urlField || !thumbField || !sendButton) return
    const details = document.createElement('details')
    details.className = 'zadark-sticker-manual'
    details.innerHTML = '<summary>Paste URL manually</summary><div class="zadark-sticker-manual__body"></div>'
    const body = details.querySelector('.zadark-sticker-manual__body')
    popover.insertBefore(details, statusElement || null)
    body.appendChild(urlField)
    body.appendChild(thumbField)
    body.appendChild(sendButton)
    popover.dataset.zadarkStickerManualMoved = 'true'
  }
  const setupFormPanel = config => {
    const anchor = document.getElementById(config.anchorId)
    if (!anchor || anchor.dataset.zadarkStickerCatalogAnchor) return
    const urlInput = document.getElementById(config.urlId)
    const thumbInput = document.getElementById(config.thumbId)
    const sendButton = document.getElementById(config.sendId)
    const statusElement = document.getElementById(config.statusId)
    if (!urlInput || !thumbInput || !sendButton) return
    const panel = anchor.closest('.zadark-sticker-panel')
    const subtitle = panel && panel.querySelector('.zadark-sticker-panel__heading p')
    subtitle && (subtitle.textContent = 'Click a pre-uploaded sticker to send it instantly.')
    const root = createCatalog(sticker => {
      urlInput.value = sticker.stickerUrl
      thumbInput.value = sticker.thumbUrl && sticker.thumbUrl !== sticker.stickerUrl ? sticker.thumbUrl : ''
      sendCatalogSticker(root, sendButton, statusElement, config.mode, sticker)
    })
    anchor.parentNode.insertBefore(root, anchor)
    anchor.dataset.zadarkStickerCatalogAnchor = 'true'
    moveManualControls(config)
    bindDirectSend({
      root,
      urlInput,
      thumbInput,
      sendButton,
      statusElement,
      mode: config.mode
    })
  }
  const setupToolbar = () => {
    const popover = document.getElementById('zadark-sticker-toolbar-popover')
    if (!popover || popover.dataset.zadarkStickerCatalogBound) return
    const firstField = popover.querySelector('.zadark-sticker-toolbar-popover__field')
    const urlInput = popover.querySelector('#zadark-sticker-toolbar-url')
    const thumbInput = popover.querySelector('#zadark-sticker-toolbar-thumb-url')
    const sendButton = popover.querySelector('.zadark-sticker-toolbar-popover__send')
    const statusElement = popover.querySelector('.zadark-sticker-toolbar-popover__status')
    if (!firstField || !urlInput || !thumbInput || !sendButton) return
    const root = createCatalog(sticker => {
      urlInput.value = sticker.stickerUrl
      thumbInput.value = sticker.thumbUrl && sticker.thumbUrl !== sticker.stickerUrl ? sticker.thumbUrl : ''
      sendCatalogSticker(root, sendButton, statusElement, 'chat', sticker)
    })
    popover.insertBefore(root, firstField)
    moveToolbarManualControls(popover, urlInput, thumbInput, sendButton, statusElement)
    popover.dataset.zadarkStickerCatalogBound = 'true'
    bindDirectSend({
      root,
      urlInput,
      thumbInput,
      sendButton,
      statusElement,
      mode: 'chat'
    })
  }
  const scan = () => {
    setupFormPanel({
      anchorId: 'js-sticker-dropzone',
      urlId: 'js-sticker-url',
      thumbId: 'js-sticker-thumb-url',
      sendId: 'js-sticker-send',
      statusId: 'js-sticker-status',
      fieldSelector: '.zadark-sticker-field',
      noteSelector: '.zadark-sticker-note',
      mode: 'popup'
    })
    setupFormPanel({
      anchorId: 'js-zadark-sticker-dropzone',
      urlId: 'js-zadark-sticker-url',
      thumbId: 'js-zadark-sticker-thumb-url',
      sendId: 'js-zadark-sticker-send',
      statusId: 'js-zadark-sticker-status',
      fieldSelector: '.zadark-sticker-field',
      noteSelector: '.zadark-sticker-note',
      mode: 'chat'
    })
    setupToolbar()
  }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', scan, {
        once: true
      })
    : scan()
  new MutationObserver(scan).observe(document.documentElement, {
    childList: true,
    subtree: true
  })
  window.ZaDarkStickerCatalog = {
    url: CATALOG_URL,
    load: loadCatalog,
    normalize: normalizeCatalog
  }
}())
