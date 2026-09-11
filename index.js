const SCENE_PATTERNS = [
    /\[\[scene_state\]\]\s*(\{[\s\S]*?\})\s*\[\[\/scene_state\]\]/i,
    /<scene_state>\s*(\{[\s\S]*?\})\s*<\/scene_state>/i,
];
const SPEAKER_RE = /\[\[speaker:([^\]\r\n]+)\]\]([\s\S]*?)\[\[\/speaker\]\]/gi;

let chatObserver = null;
let observedChat = null;
let discoveryObserver = null;
let pending = new Set();
let framePending = false;

function log(...args) {
    console.debug('[Scene State]', ...args);
}

function stateFromJson(text) {
    try {
        const value = JSON.parse(text);
        const state = {
            location: String(value?.location ?? '').trim(),
            date: String(value?.date ?? '').trim(),
            time: String(value?.time ?? '').trim(),
        };
        return state.location || state.date || state.time ? state : null;
    } catch {
        return null;
    }
}

function findScene(text) {
    const source = String(text ?? '');

    for (const pattern of SCENE_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(source);
        const state = match && stateFromJson(match[1]);
        if (state) {
            return {
                state,
                start: match.index,
                end: match.index + match[0].length,
            };
        }
    }

    // Compatibility with old messages where the wrapper disappeared but the
    // state JSON remained visible at the end of the response.
    const trimmed = source.trimEnd();
    const start = trimmed.lastIndexOf('{');
    if (start >= 0) {
        const candidate = trimmed.slice(start);
        if (/"location"\s*:/.test(candidate)
            && /"date"\s*:/.test(candidate)
            && /"time"\s*:/.test(candidate)) {
            const state = stateFromJson(candidate);
            if (state) return { state, start, end: source.length };
        }
    }

    return null;
}

function pointAt(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0;
    let last = null;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const length = node.nodeValue?.length ?? 0;
        last = node;
        if (offset <= total + length) {
            return {
                node,
                offset: Math.max(0, Math.min(length, offset - total)),
            };
        }
        total += length;
    }

    return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : null;
}

function deleteRange(root, start, end) {
    if (end <= start) return;
    const first = pointAt(root, start);
    const last = pointAt(root, end);
    if (!first || !last) return;

    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    range.deleteContents();
}

function hueFor(name) {
    let hash = 2166136261;
    for (const ch of String(name).trim().toLowerCase()) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 360;
}

function colorRange(root, start, end, speaker) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let total = 0;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const length = node.nodeValue?.length ?? 0;
        nodes.push({ node, start: total, end: total + length });
        total += length;
    }

    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const item = nodes[index];
        const rangeStart = Math.max(start, item.start);
        const rangeEnd = Math.min(end, item.end);
        if (rangeStart >= rangeEnd) continue;

        let target = item.node;
        const localStart = rangeStart - item.start;
        const localEnd = rangeEnd - item.start;
        if (localStart > 0) target = target.splitText(localStart);

        const selectedLength = localEnd - localStart;
        if (selectedLength < target.nodeValue.length) target.splitText(selectedLength);
        if (target.parentElement?.closest('.tt-speaker-dialogue')) continue;

        const span = document.createElement('span');
        span.className = 'tt-speaker-dialogue';
        span.dataset.speaker = speaker;
        span.title = speaker;
        span.style.setProperty('--tt-speaker-hue', String(hueFor(speaker)));
        target.parentNode.insertBefore(span, target);
        span.appendChild(target);
    }
}

function decorateSpeakers(content) {
    const text = content.textContent || '';
    SPEAKER_RE.lastIndex = 0;
    const matches = [...text.matchAll(SPEAKER_RE)];

    for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        const full = match[0];
        const speaker = String(match[1] ?? '').trim();
        const dialogue = match[2] ?? '';
        const dialogueOffset = full.indexOf(dialogue);
        const closeOffset = full.lastIndexOf('[[/speaker]]');
        if (!speaker || dialogueOffset < 0 || closeOffset < 0) continue;

        const start = match.index;
        const dialogueStart = start + dialogueOffset;
        const dialogueEnd = dialogueStart + dialogue.length;
        const closeStart = start + closeOffset;
        const end = start + full.length;

        colorRange(content, dialogueStart, dialogueEnd, speaker);
        deleteRange(content, closeStart, end);
        deleteRange(content, start, dialogueStart);
    }
}

function makeHeader(state) {
    const box = document.createElement('div');
    box.className = 'tt-scene-header';

    const location = document.createElement('div');
    location.className = 'tt-scene-header-location';
    location.textContent = `📍 ${state.location || 'Location unknown'}`;

    const when = document.createElement('div');
    when.className = 'tt-scene-header-time';
    when.textContent = `🕒 ${[state.date, state.time].filter(Boolean).join(' — ') || 'Time unknown'}`;

    box.append(location, when);
    return box;
}

function decorateContent(content) {
    if (!(content instanceof HTMLElement)) return;

    const initialText = content.textContent || '';
    const scene = findScene(initialText);
    const hasSpeakerData = initialText.includes('[[speaker:');
    if (!scene && !hasSpeakerData) return;

    // ChatSurface may rewrite an already-decorated message. If that happens,
    // discard our old header before recalculating offsets from the raw markers.
    content.querySelectorAll('.tt-scene-header').forEach(node => node.remove());

    const currentScene = findScene(content.textContent || '');
    if (currentScene) deleteRange(content, currentScene.start, currentScene.end);

    decorateSpeakers(content);

    if (currentScene?.state) content.prepend(makeHeader(currentScene.state));
}

function queueContent(content) {
    if (!(content instanceof HTMLElement)) return;
    pending.add(content);
    if (framePending) return;

    framePending = true;
    requestAnimationFrame(() => {
        framePending = false;
        const work = [...pending];
        pending.clear();
        for (const item of work) {
            if (item.isConnected) decorateContent(item);
        }
    });
}

function collectFromNode(node) {
    if (node instanceof Text) {
        const content = node.parentElement?.closest('.mes_text');
        if (content) queueContent(content);
        return;
    }

    if (!(node instanceof HTMLElement)) return;
    if (node.matches('.mes_text')) queueContent(node);

    const parentContent = node.closest('.mes_text');
    if (parentContent) queueContent(parentContent);

    node.querySelectorAll?.('.mes_text').forEach(queueContent);
}

function processAll() {
    document.querySelectorAll('#chat > .mes .mes_text').forEach(queueContent);
}

function observeChat(chat) {
    if (!(chat instanceof HTMLElement) || observedChat === chat) return;

    chatObserver?.disconnect();
    observedChat = chat;
    chatObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            collectFromNode(mutation.target);
            mutation.addedNodes.forEach(collectFromNode);
        }
    });
    chatObserver.observe(chat, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    processAll();
    log('Chat DOM observer active');
}

function ensureChatObserver() {
    const chat = document.querySelector('#chat');
    if (!(chat instanceof HTMLElement)) return false;

    observeChat(chat);
    discoveryObserver?.disconnect();
    discoveryObserver = null;
    return true;
}

function startDiscoveryObserver() {
    if (ensureChatObserver()) return;

    const root = document.documentElement || document.body;
    if (!root) {
        setTimeout(startDiscoveryObserver, 100);
        return;
    }

    discoveryObserver?.disconnect();
    discoveryObserver = new MutationObserver(() => ensureChatObserver());
    discoveryObserver.observe(root, { childList: true, subtree: true });
}

function bindHostEvents() {
    try {
        const context = window.SillyTavern?.getContext?.();
        const eventSource = context?.eventSource;
        const eventTypes = context?.eventTypes;
        if (!eventSource || !eventTypes) return;

        const processMessage = id => {
            requestAnimationFrame(() => {
                const content = document.querySelector(`#chat > .mes[mesid="${id}"] .mes_text`);
                if (content) queueContent(content);
                else processAll();
            });
        };

        for (const key of ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED']) {
            const event = eventTypes[key];
            if (event) eventSource.on(event, processMessage);
        }

        for (const key of ['CHAT_CHANGED', 'CHAT_LOADED']) {
            const event = eventTypes[key];
            if (event) eventSource.on(event, processAll);
        }
    } catch (error) {
        console.warn('[Scene State] Host event binding failed; DOM observer remains active.', error);
    }
}

function init() {
    // TauriTavern defers ordinary third-party extension activation until after
    // APP_READY, while ChatSurface participant registration freezes at the
    // first projection. A late participant therefore cannot be cold-start
    // reliable. This extension intentionally uses a resilient DOM decorator
    // that re-applies after TauriTavern mounts or rewrites message content.
    startDiscoveryObserver();
    bindHostEvents();
    processAll();
    log('v0.3.1 initialized');
}

init();
