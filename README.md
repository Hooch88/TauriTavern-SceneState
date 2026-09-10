# TauriTavern Scene State

Version 0.3.0

A lightweight TauriTavern extension with two narrator-facing display features:

1. **Scene header** — shows the current in-world location, date, and time above narrator responses.
2. **Speaker colors** — gives each NPC a stable dialogue color derived from the speaker name, while leaving narration in the normal theme color.

## Install

In TauriTavern, use the third-party extension installer and paste:

    https://github.com/Hooch88/TauriTavern-SceneState

Update/reload TauriTavern after a new release.

## 07 — Scene State

Add the contents of `PROMPT_MODULE.txt` as a **System** prompt near the end of your preset.

The narrator now emits renderer-safe plain-text markers:

    [[scene_state]]
    {"location":"Sigma Tau House — Eugene, Oregon","date":"September 11, 2026","time":"11:42 PM"}
    [[/scene_state]]

The extension removes that metadata from display and renders the scene header at the top of the narrator message.

Version 0.3.0 still recognizes the older `<scene_state>...</scene_state>` form and bare trailing state JSON for backward compatibility.

## 08 — Speaker Colors

Add the contents of `SPEAKER_MODULE.txt` as another **System** prompt near the Scene State module.

The narrator emits:

    [[speaker:Ms. Adair]]
    "Grant, I need you to be very precise with me."
    [[/speaker]]

The extension removes the markers and colors only the enclosed dialogue. The same exact speaker name maps deterministically to the same color.

## TauriTavern integration

Version 0.3.0 uses TauriTavern's `chatSurface` participant API when managed message ownership is enabled. This is the supported place to modify detached `.mes_text` content before TauriTavern commits it to the live chat surface. On older/static hosts it falls back to normal SillyTavern message-render events.

This avoids relying on a long-running DOM MutationObserver that can be overwritten by TauriTavern's windowed/managed chat rendering.

## Design

- no external API or second model call
- no lorebook dependency
- no separate Regex extension required
- renderer-safe scene markers
- deterministic speaker colors derived from speaker names
- narration remains in the normal theme color
- Scene State and Speaker Colors remain separate preset modules

## Files

- `manifest.json` — extension metadata
- `index.js` — ChatSurface integration and rendering
- `style.css` — scene header and speaker styling
- `PROMPT_MODULE.txt` — scene-state narrator instruction
- `SPEAKER_MODULE.txt` — speaker-tagging narrator instruction
