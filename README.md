# TauriTavern Scene State

Version 0.1.0

A lightweight TauriTavern extension that displays the current **in-world location, date, and time** above narrator responses.

Example:

    📍 Sigma Tau House — Eugene, Oregon
    🕒 Friday, September 11, 2026 — 11:42 PM

## Install

In TauriTavern, use the third-party extension installer and paste:

    https://github.com/Hooch88/TauriTavern-SceneState

Reload TauriTavern after installation if needed.

## Required preset module

This extension does not guess fictional time/location from prose. The narrator supplies authoritative scene state at the end of each response.

Add the contents of `PROMPT_MODULE.txt` as a separate **System** prompt in your preset.

Recommended name:

    07 — Scene State

Recommended placement:

    Late in the prompt, after Chat History / near final generation instructions.

The narrator will append:

    <scene_state>
    {"location":"Sigma Tau House — Eugene, Oregon","date":"Friday, September 11, 2026","time":"11:42 PM"}
    </scene_state>

The extension hides that block, persists the latest values per chat, and renders the clean header above narrator messages.

## Design

- in-world location/date/time only
- no external API or second model call
- per-chat persistence via TauriTavern's native extension store
- no lorebook dependency
- no real-world/system-clock substitution
- narrator/model remains authoritative for fictional time progression

## Files

- `manifest.json` — extension metadata
- `index.js` — extraction, persistence, and rendering
- `style.css` — header appearance
- `PROMPT_MODULE.txt` — required narrator instruction
