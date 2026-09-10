# TauriTavern Scene State

Version 0.2.0

A lightweight TauriTavern extension that adds two narrator-facing display features:

1. **Scene header** — shows the current in-world location, date, and time above narrator responses.
2. **Speaker colors** — gives each NPC a stable dialogue color based on the speaker name, while leaving narration in the normal theme color.

Example scene header:

    📍 Sigma Tau House — Eugene, Oregon
    🕒 Friday, September 11, 2026 — 11:42 PM

## Install

In TauriTavern, use the third-party extension installer and paste:

    https://github.com/Hooch88/TauriTavern-SceneState

Reload TauriTavern after installation or update if needed.

## Scene State preset module

Add the contents of `PROMPT_MODULE.txt` as a separate **System** prompt in your preset.

Recommended name:

    07 — Scene State

Recommended placement:

    Late in the prompt, after Chat History / near final generation instructions.

The narrator appends:

    <scene_state>
    {"location":"Sigma Tau House — Eugene, Oregon","date":"Friday, September 11, 2026","time":"11:42 PM"}
    </scene_state>

The extension consumes that state and renders the clean header above narrator messages.

## Speaker Colors preset module

Add the contents of `SPEAKER_MODULE.txt` as another **System** prompt.

Recommended name:

    08 — Speaker Colors

Recommended placement:

    Immediately before or after the Scene State module, late in the prompt.

The narrator emits internal markers such as:

    [[speaker:Ms. Adair]]
    "Grant, I need you to be very precise with me."
    [[/speaker]]

The extension removes the markers from display and colors only the dialogue. The same exact speaker name always maps to the same color within and across messages.

Narration remains in the normal TauriTavern theme color.

## Design

- no external API or second model call
- no lorebook dependency
- per-chat scene-state persistence
- deterministic speaker colors derived from speaker names
- no visible speaker labels required
- speaker tagging and scene-state tracking are independent prompt modules

## Files

- `manifest.json` — extension metadata
- `index.js` — scene extraction, persistence, speaker parsing, and rendering
- `style.css` — header and speaker styling
- `PROMPT_MODULE.txt` — scene-state narrator instruction
- `SPEAKER_MODULE.txt` — speaker-tagging narrator instruction
