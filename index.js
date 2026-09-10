const EXT_NAME = 'tt-scene-state';
const STATE_KEY = 'current';
const TAG_RE = /<scene_state>\s*([\s\S]*?)\s*<\/scene_state>/i;

let currentState = null;
let observer = null;
let saveTimer = null;
let rendering = false;

function log(...args) {
    console.debug('[Scene State]', ...args);
}

async function waitForTauriTavern() {
    try {
        if (window.__TAURITAVERN__) {
            await (window.__TAURITAVERN__.ready ?? window.__TAURITAVERN_MAIN_READY__);
            return true;
        }
    } catch (err) {
        console.warn('[Scene State] TauriTavern host ready wait failed:', err);
    }
    return false;
}

function getHandle() {
    try {
        return window.__TAURITAVERN__?.api?.chat?.current?.handle?.() ?? null;
    } catch {
        return null;
    }
}

function getContext() {
    try {
        return window.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function normalizeState(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const location = String(obj.location ?? '').trim();
    const date = String(obj.date ?? '').trim();
    const time = String(obj.time ?? '').trim();
    if (!location && !date && !time) return null;
    return { location, date, time };
}

function parseSceneState(raw) {
    const match = String(raw ?? '').match(TAG_RE);
    if (!match) return null;

    const body = match[1].trim();
    try {
        return normalizeState(JSON.parse(body));
    } catch {}

    const obj = {};
    for (const line of body.split(/\r?\n/)) {
        const m = line.match(/^\s*(location|date|time)\s*:\s*(.*?)\s*$/i);
        if (m) obj[m[1].toLowerCase()] = m[2];
    }
    return normalizeState(obj);
}

function stripSceneState(raw) {
    return String(raw ?? '').replace(TAG_RE, '').trimEnd();
}

// Finds a trailing visible JSON object even if TauriTavern has already stripped
// the <scene_state> wrapper before the extension sees the rendered message.
function parseTrailingVisibleState(text) {
    const src = String(text ?? '').trimEnd();
    const start = src.lastIndexOf('{');
    if (start < 0) return null;

    const candidate = src.slice(start).trim();
    if (!candidate.endsWith('}')) return null;
    if (!/"location"\s*:/.test(candidate) || !/"date"\s*:/.test(candidate) || !/"time"\s*:/.test(candidate)) {
        return null;
    }

    try {
        const state = normalizeState(JSON.parse(candidate));
        if (!state) return null;
        return { state, startIndex: start, candidate };
    } catch {
        return null;
    }
}

async function loadStoredState() {
    const handle = getHandle();
    if (!handle?.store?.getJson || !handle?.store?.listKeys) return null;

    try {
        const keys = await handle.store.listKeys({ namespace: EXT_NAME });
        const keyList = Array.isArray(keys) ? keys : (Array.isArray(keys?.keys) ? keys.keys : []);
        if (!keyList.includes(STATE_KEY)) return null;

        const value = await handle.store.getJson({ namespace: EXT_NAME, key: STATE_KEY });
        return normalizeState(value);
    } catch (err) {
        console.warn('[Scene State] Failed to read stored scene state:', err);
        return null;
    }
}

function persistStateSoon(state) {
    currentState = normalizeState(state);
    if (!currentState) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        const handle = getHandle();
        if (!handle?.store?.setJson) return;
        try {
            await handle.store.setJson({ namespace: EXT_NAME, key: STATE_KEY, value: currentState });
        } catch (err) {
            console.warn('[Scene State] Failed to persist scene state:', err);
        }
    }, 100);
}

function buildHeader(state) {
    const header = document.createElement('div');
    header.className = 'tt-scene-header';
    header.setAttribute('data-tt-scene-header', 'true');

    const location = document.createElement('div');
    location.className = 'tt-scene-header-location';
    location.textContent = state.location ? `📍 ${state.location}` : '📍 Location unknown';

    const clock = document.createElement('div');
    clock.className = 'tt-scene-header-time';
    const when = [state.date, state.time].filter(Boolean).join(' — ');
    clock.textContent = `🕒 ${when || 'Time unknown'}`;

    header.append(location, clock);
    return header;
}

function getMessageRecord(mes) {
    const mesId = Number(mes.getAttribute('mesid'));
    if (!Number.isInteger(mesId) || mesId < 0) return null;
    const ctx = getContext();
    const msg = ctx?.chat?.[mesId] ?? null;
    return msg ? { msg, mesId, ctx } : null;
}

function getRawMessage(mes) {
    const record = getMessageRecord(mes);
    if (record?.msg?.mes != null) return String(record.msg.mes);
    const textEl = mes.querySelector('.mes_text');
    return textEl?.innerText || textEl?.textContent || '';
}

function formatCleanMessage(mes, cleanRaw) {
    const textEl = mes.querySelector('.mes_text');
    if (!textEl) return false;

    const record = getMessageRecord(mes);
    const formatter = window.SillyTavern?.messageFormatting;
    if (record && typeof formatter === 'function') {
        const { msg, mesId } = record;
        textEl.innerHTML = formatter(
            cleanRaw,
            msg.name,
            Boolean(msg.is_system),
            Boolean(msg.is_user),
            mesId,
        );
        return true;
    }
    return false;
}

// Remove everything from a character offset in an element's visible text to
// the end while preserving the HTML/Markdown formatting before that point.
function deleteTextFromOffset(root, startOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let total = 0;
    let startNode = null;
    let startNodeOffset = 0;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const len = node.nodeValue?.length ?? 0;
        nodes.push(node);
        if (!startNode && startOffset <= total + len) {
            startNode = node;
            startNodeOffset = Math.max(0, startOffset - total);
        }
        total += len;
    }

    if (!startNode) return false;

    const range = document.createRange();
    range.setStart(startNode, Math.min(startNodeOffset, startNode.nodeValue.length));
    range.setEnd(root, root.childNodes.length);
    range.deleteContents();

    // Remove empty trailing wrappers left behind after deleting the JSON.
    let child = root.lastElementChild;
    while (child && !child.textContent.trim() && !child.querySelector('img,video,audio,iframe')) {
        const prev = child.previousElementSibling;
        child.remove();
        child = prev;
    }
    return true;
}

function removeVisibleTrailingState(textEl, visible) {
    if (!visible) return false;
    const full = textEl.textContent || '';
    const suffixStart = full.lastIndexOf(visible.candidate);
    if (suffixStart < 0) return false;
    return deleteTextFromOffset(textEl, suffixStart);
}

function isAssistantMessage(mes) {
    const isUserAttr = mes.getAttribute('is_user');
    if (isUserAttr === 'true') return false;
    if (mes.classList.contains('user_mes')) return false;
    return true;
}

function renderOneMessage(mes, inheritedState = null) {
    if (!(mes instanceof HTMLElement) || !mes.matches('.mes')) return inheritedState;
    if (!isAssistantMessage(mes)) return inheritedState;

    const textEl = mes.querySelector('.mes_text');
    if (!textEl) return inheritedState;

    const raw = getRawMessage(mes);
    const rawState = parseSceneState(raw);
    const visibleState = parseTrailingVisibleState(textEl.textContent || '');
    const found = rawState || visibleState?.state || null;
    const state = found || inheritedState || currentState;

    if (rawState) {
        // Prefer a clean re-render from raw text when the host formatter is exposed.
        const cleanRaw = stripSceneState(raw);
        const formatted = formatCleanMessage(mes, cleanRaw);
        if (!formatted) {
            // If formatter is unavailable, remove any JSON that leaked into rendered text.
            removeVisibleTrailingState(textEl, visibleState);
        }
    } else if (visibleState) {
        // Android/current TauriTavern may strip the XML wrapper before DOM rendering.
        removeVisibleTrailingState(textEl, visibleState);
    }

    if (found) persistStateSoon(found);

    const old = mes.querySelector('.tt-scene-header');
    if (old) old.remove();

    if (state) {
        const header = buildHeader(state);
        const insertionPoint = mes.querySelector('.mes_block') || textEl.parentElement || mes;
        if (insertionPoint === mes) mes.prepend(header);
        else insertionPoint.insertBefore(header, textEl);
    }

    return found || state;
}

function renderAll() {
    if (rendering) return;
    const chat = document.querySelector('#chat');
    if (!chat) return;

    rendering = true;
    try {
        let state = currentState;
        const messages = [...chat.querySelectorAll('.mes')];
        for (const mes of messages) state = renderOneMessage(mes, state);
    } finally {
        rendering = false;
    }
}

function observeChat() {
    const chat = document.querySelector('#chat');
    if (!chat) {
        setTimeout(observeChat, 500);
        return;
    }

    observer?.disconnect();
    observer = new MutationObserver(() => {
        if (!rendering) requestAnimationFrame(renderAll);
    });
    observer.observe(chat, { childList: true, subtree: true, characterData: true });
}

async function refreshForCurrentChat() {
    currentState = await loadStoredState();
    renderAll();
}

async function init() {
    await waitForTauriTavern();
    currentState = await loadStoredState();

    observeChat();
    renderAll();

    try {
        const ctx = getContext();
        const eventSource = ctx?.eventSource;
        const eventTypes = ctx?.eventTypes;

        if (eventSource && eventTypes) {
            if (eventTypes.CHAT_CHANGED) {
                eventSource.on(eventTypes.CHAT_CHANGED, async () => {
                    await refreshForCurrentChat();
                });
            }

            const rerenderEvents = [
                eventTypes.MESSAGE_RECEIVED,
                eventTypes.MESSAGE_UPDATED,
                eventTypes.MESSAGE_EDITED,
                eventTypes.MESSAGE_DELETED,
                eventTypes.CHARACTER_MESSAGE_RENDERED,
                eventTypes.GENERATION_ENDED,
            ].filter(Boolean);

            rerenderEvents.forEach(evt => {
                eventSource.on(evt, () => requestAnimationFrame(renderAll));
            });
        }
    } catch (err) {
        log('Host events unavailable; MutationObserver fallback remains active.', err);
    }

    log('Loaded');
}

init();
