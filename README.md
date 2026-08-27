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
- In-browser transcription with open-source Whisper via Transformers.js
- Paste or upload `.txt` transcripts
- Built-in two-speaker Australian demo call and matching transcript
- Local evidence-first structured ticket generation
- JSON copy action
- Responsive layout

## Important note

This package does not require a private transcription API or API key. Audio transcription runs locally in the browser using open-source Whisper. The model is downloaded on first use and cached by the browser. Structured extraction is implemented locally with evidence-based parsing rules.

## Brand implementation

The UI follows the requested palette: red accent, black/charcoal dark modules, and white/off-white surfaces. The small header wordmark is a text treatment for this prototype and is not an official Normet logo asset.
