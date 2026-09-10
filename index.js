const EXT_ID = 'tt-scene-state/presentation';
const SCENE_PATTERNS = [
    /\[\[scene_state\]\]\s*(\{[\s\S]*?\})\s*\[\[\/scene_state\]\]/i,
    /<scene_state>\s*(\{[\s\S]*?\})\s*<\/scene_state>/i,
];
const SPEAKER_RE = /\[\[speaker:([^\]\r\n]+)\]\]([\s\S]*?)\[\[\/speaker\]\]/gi;

function stateFromJson(text) {
    try {
        const v = JSON.parse(text);
        const state = {
            location: String(v?.location ?? '').trim(),
            date: String(v?.date ?? '').trim(),
            time: String(v?.time ?? '').trim(),
        };
        return state.location || state.date || state.time ? state : null;
    } catch { return null; }
}

function findScene(text) {
    const src = String(text ?? '');
    for (const re of SCENE_PATTERNS) {
        const m = re.exec(src);
        const state = m && stateFromJson(m[1]);
        if (state) return { state, start: m.index, end: m.index + m[0].length };
    }

    // Compatibility with earlier replies where the HTML-like wrapper was stripped.
    const trimmed = src.trimEnd();
    const start = trimmed.lastIndexOf('{');
    if (start >= 0) {
        const candidate = trimmed.slice(start);
        if (/"location"\s*:/.test(candidate) && /"date"\s*:/.test(candidate) && /"time"\s*:/.test(candidate)) {
            const state = stateFromJson(candidate);
            if (state) return { state, start, end: trimmed.length };
        }
    }
    return null;
}

function pointAt(root, offset) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0, last = null;
    while (w.nextNode()) {
        const node = w.currentNode;
        const len = node.nodeValue?.length ?? 0;
        last = node;
        if (offset <= total + len) return { node, offset: Math.max(0, Math.min(len, offset - total)) };
        total += len;
    }
    return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : null;
}

function deleteRange(root, start, end) {
    if (end <= start) return;
    const a = pointAt(root, start), b = pointAt(root, end);
    if (!a || !b) return;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    range.deleteContents();
}

function hueFor(name) {
    let h = 2166136261;
    for (const ch of String(name).trim().toLowerCase()) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 360;
}

function colorRange(root, start, end, speaker) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let total = 0;
    while (w.nextNode()) {
        const node = w.currentNode;
        const len = node.nodeValue?.length ?? 0;
        nodes.push({ node, start: total, end: total + len });
        total += len;
    }

    for (let i = nodes.length - 1; i >= 0; i--) {
        const item = nodes[i];
        const a = Math.max(start, item.start), b = Math.min(end, item.end);
        if (a >= b) continue;
        let target = item.node;
        const localA = a - item.start, localB = b - item.start;
        if (localA > 0) target = target.splitText(localA);
        const len = localB - localA;
        if (len < target.nodeValue.length) target.splitText(len);
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
    const matches = [...text.matchAll(SPEAKER_RE)];
    for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i], full = m[0], speaker = String(m[1]).trim(), dialogue = m[2] ?? '';
        const dialogueOffset = full.indexOf(dialogue);
        const closeOffset = full.lastIndexOf('[[/speaker]]');
        if (!speaker || dialogueOffset < 0 || closeOffset < 0) continue;
        const start = m.index;
        const dStart = start + dialogueOffset, dEnd = dStart + dialogue.length;
        const closeStart = start + closeOffset, end = start + full.length;
        colorRange(content, dStart, dEnd, speaker);
        deleteRange(content, closeStart, end);
        deleteRange(content, start, dStart);
    }
}

function makeHeader(state) {
    const box = document.createElement('div');
    box.className = 'tt-scene-header';
    const loc = document.createElement('div');
    loc.className = 'tt-scene-header-location';
    loc.textContent = `📍 ${state.location || 'Location unknown'}`;
    const when = document.createElement('div');
    when.className = 'tt-scene-header-time';
    when.textContent = `🕒 ${[state.date, state.time].filter(Boolean).join(' — ') || 'Time unknown'}`;
    box.append(loc, when);
    return box;
}

function decorateContent(content) {
    if (!(content instanceof HTMLElement)) return;
    const text = content.textContent || '';
    if (!text.includes('[[speaker:') && !text.includes('[[scene_state]]') && !text.includes('<scene_state>') && !findScene(text)) return;

    const scene = findScene(text);
    if (scene) deleteRange(content, scene.start, scene.end);
    decorateSpeakers(content);
    if (scene?.state) content.prepend(makeHeader(scene.state));
}

function startLegacy() {
    const processAll = () => document.querySelectorAll('#chat > .mes .mes_text').forEach(decorateContent);
    const ctx = window.SillyTavern?.getContext?.();
    const onMessage = (id) => {
        const el = document.querySelector(`#chat > .mes[mesid="${id}"] .mes_text`);
        if (el) decorateContent(el);
    };
    if (ctx?.eventSource && ctx?.eventTypes) {
        for (const key of ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED']) {
            const event = ctx.eventTypes[key];
            if (event) ctx.eventSource.on(event, onMessage);
        }
    }
    processAll();
}

async function init() {
    try { await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__); } catch {}
    const api = window.__TAURITAVERN__?.api?.chatSurface;
    if (api?.isManagedOwnershipRequired?.() === true && api?.registerParticipant) {
        try {
            api.registerParticipant({
                id: EXT_ID,
                protocolVersion: api.protocolVersion,
                prepareContent({ content }) { decorateContent(content); },
            });
            console.debug('[Scene State] ChatSurface participant registered');
            return;
        } catch (error) {
            console.error('[Scene State] ChatSurface registration failed:', error);
        }
    }
    startLegacy();
    console.debug('[Scene State] Legacy renderer active');
}

init();
