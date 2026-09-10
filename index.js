const EXT_NAME = 'tt-scene-state';
const STATE_KEY = 'current';
const TAG_RE = /<scene_state>\s*([\s\S]*?)\s*<\/scene_state>/i;

let currentState = null;
let observer = null;
let saveTimer = null;

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

async function loadStoredState() {
    const handle = getHandle();
    if (!handle?.store?.getJson) return null;
    try {
        const value = await handle.store.getJson({
            namespace: EXT_NAME,
            key: STATE_KEY,
        });
        return normalizeState(value);
    } catch (err) {
        log('No stored state yet:', err);
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
            await handle.store.setJson({
                namespace: EXT_NAME,
                key: STATE_KEY,
                value: currentState,
            });
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

function stripStateTagFromElement(textEl) {
    const explicitTags = textEl.querySelectorAll?.('scene_state');
    explicitTags?.forEach(el => el.remove());

    const html = textEl.innerHTML;
    if (TAG_RE.test(html)) {
        textEl.innerHTML = html.replace(TAG_RE, '').trim();
    }
}

function extractRawFromMessage(mes) {
    const textEl = mes.querySelector('.mes_text');
    if (!textEl) return '';
    return textEl.innerText || textEl.textContent || '';
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

    const raw = extractRawFromMessage(mes);
    const found = parseSceneState(raw) || parseSceneState(textEl.innerHTML);
    const state = found || inheritedState || currentState;

    stripStateTagFromElement(textEl);

    const old = mes.querySelector('.tt-scene-header');
    if (old) old.remove();

    if (state) {
        const header = buildHeader(state);
        const insertionPoint = mes.querySelector('.mes_block') || textEl.parentElement || mes;
        if (insertionPoint === mes) {
            mes.prepend(header);
        } else {
            insertionPoint.insertBefore(header, textEl);
        }
    }

    if (found) {
        persistStateSoon(found);
        return found;
    }
    return state;
}

function renderAll() {
    const chat = document.querySelector('#chat');
    if (!chat) return;

    let state = currentState;
    const messages = [...chat.querySelectorAll('.mes')];
    for (const mes of messages) {
        state = renderOneMessage(mes, state);
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
        requestAnimationFrame(renderAll);
    });
    observer.observe(chat, {
        childList: true,
        subtree: true,
        characterData: true,
    });
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
        const ctx = window.SillyTavern?.getContext?.();
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
