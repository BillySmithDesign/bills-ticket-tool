# Bill's Ticket Tool — Local Normet UI Prototype

A local static rebuild of the Bill's Ticket Tool with a Normet-inspired red / charcoal / white visual system.

## Run locally

### Fastest
From this folder:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

### Alternative with Node

```bash
npx serve .
```

## Included functionality

- Browser microphone recording with `MediaRecorder`
- Upload and playback of an audio recording
- Paste or upload `.txt` transcripts
- Demo transcript
- Local evidence-first structured ticket generation
- JSON copy action
- Responsive layout

## Important note

This package is intentionally self-contained and does not include any private API/backend from the hosted prototype. Structured extraction is implemented locally with evidence-based parsing rules. If the hosted version used an AI transcription or extraction API, those credentials/backend endpoints would need to be connected separately to reproduce that exact server-side behaviour.

## Brand implementation

The UI follows the requested palette: red accent, black/charcoal dark modules, and white/off-white surfaces. The small header wordmark is a text treatment for this prototype and is not an official Normet logo asset.
