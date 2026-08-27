# Bill's Ticket Tool

Bill's Ticket Tool is a simple browser application for turning underground mining equipment support calls into structured service tickets.

It can record a speakerphone call, accept an uploaded recording, or accept a written transcript. Audio is transcribed in the browser with open-source Whisper, then converted into an evidence-backed ticket. Information that was not discussed is clearly marked **Not discussed** rather than invented.

**Live application:** [bill-support.vercel.app](https://bill-support.vercel.app/)

## What it does

- Records audio with the browser microphone
- Uploads common audio recording formats
- Transcribes audio locally with Whisper and Transformers.js
- Accepts pasted or uploaded `.txt` transcripts
- Includes a built-in two-speaker Australian demo call
- Extracts machine, customer, fault and safety information
- Shows the supporting transcript excerpt for every extracted value
- Displays the complete raw JSON payload
- Copies or downloads the ticket as a `.json` file
- Produces a stable payload ready to map into Microsoft D365 Customer Service

## How it works

1. The user records or uploads a support call.
2. The browser converts the audio to 16 kHz mono.
3. Transformers.js runs the open-source Whisper model inside the browser.
4. The transcript is placed in the transcript box for review.
5. Local evidence-based rules extract the ticket fields.
6. The structured ticket and matching raw JSON are displayed.
7. The JSON can be copied, downloaded or later passed to D365.

No transcription API key is required. Audio is processed on the user's device rather than uploaded to this application.

## Ticket fields

The current ticket includes:

- Customer
- Mine site
- Caller
- Machine model
- Machine serial number
- Equipment hours
- Fault description
- Fault codes
- Machine status
- Safety risk
- Troubleshooting completed
- Recommended actions
- Call summary

Every field contains both a value and supporting transcript evidence. Missing information is returned as `Not discussed`.

The downloaded payload also includes:

```json
{
  "schema_version": "1.0",
  "source": "bills-ticket-tool",
  "target": "d365_customer_service",
  "generated_at": "2026-08-28T00:00:00.000Z"
}
```

## Using the application

### Try the built-in demo

1. Open the [live application](https://bill-support.vercel.app/).
2. Select **Load demo recording**.
3. The Australian two-speaker demo call will play.
4. Its transcript and structured ticket will load automatically.
5. Scroll down to view the structured fields and raw JSON.
6. Select **Copy JSON** or **Download ticket**.

### Record a call

1. Confirm that everyone on the call consents to being recorded.
2. Put the phone call on speaker using a separate device.
3. Select the red record button.
4. Allow microphone access when the browser asks.
5. Select the button again to stop recording.
6. Wait while Whisper transcribes the recording.
7. Review the transcript and select **Generate structured ticket**.

### Upload a recording

1. Select **Upload recording**.
2. Choose an audio file from the device.
3. Wait for the Whisper model and transcription to finish.
4. Review the transcript.
5. Select **Generate structured ticket**.

The first transcription takes longer because the browser must download and cache the Whisper model. Later transcriptions are faster.

## Run it locally

### Requirements

- Git
- Python 3 or Node.js
- A modern browser; Chrome or Edge is recommended

### Option 1: Python

```bash
git clone https://github.com/BillySmithDesign/bills-ticket-tool.git
cd bills-ticket-tool
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

### Option 2: Node.js

```bash
git clone https://github.com/BillySmithDesign/bills-ticket-tool.git
cd bills-ticket-tool
npx serve .
```

Open the local address shown in the terminal.

Do not open `index.html` directly as a local file. A local web server is needed for browser modules, microphone access and model downloads.

## Deploy your own copy to Vercel

1. Fork this repository or copy it into your own GitHub account.
2. Sign in to [Vercel](https://vercel.com/).
3. Select **Add New** and then **Project**.
4. Import the GitHub repository.
5. Set **Framework Preset** to **Other**.
6. Leave Build Command, Output Directory and Install Command empty.
7. Select **Deploy**.

No environment variables are required for the current version.

Vercel will automatically deploy future pushes to the repository's `main` branch.

## Connecting to Microsoft D365 Customer Service

The application currently creates a D365-targeted JSON contract, but it does not yet submit records directly to Dataverse.

A D365 integration will need:

1. The Dataverse environment URL
2. The target table, normally the Case/Incident table
3. The logical name of every destination field
4. Customer and contact lookup rules
5. Microsoft Entra ID authentication or a Power Automate flow

An easy first integration is:

1. Create a Power Automate flow with an HTTP request trigger.
2. Use **Parse JSON** with a sample downloaded ticket.
3. Add a Dataverse **Add a new row** action.
4. Map the Bill's Ticket Tool fields to the D365 Case fields.
5. Store the flow URL securely in a Vercel server-side function before enabling direct submission.

Do not place D365 client secrets or access tokens in `app.js`; browser code is public.

## Project files

```text
bills-ticket-tool/
├── index.html     Page structure and controls
├── styles.css     Normet-inspired responsive design
├── app.js         Recording, transcription, extraction and JSON logic
├── README.md      Project and setup instructions
└── LICENSE        Open-source licence
```

## Customising the project

- Edit `demoTranscript` in `app.js` to change the demo conversation.
- Edit `fields` in `app.js` to change the ticket schema.
- Edit `WHISPER_MODEL` in `app.js` to choose another compatible Whisper model.
- Edit the CSS variables at the top of `styles.css` to change the colour palette.
- Replace the logo URL in `index.html` with an appropriately licensed local asset for long-term production use.

Larger Whisper models may improve accuracy but take longer to download and require more device memory.

## Troubleshooting

### Microphone access is denied

- Open the browser's site permissions for the application.
- Allow microphone access.
- Reload the page.
- Microphone recording requires HTTPS or `localhost`.

### Transcription is slow

- The first run downloads the Whisper model.
- Keep the page open until the status reports that transcription is ready.
- Chrome or Edge with WebGPU generally performs best.
- Older devices will use the slower WebAssembly fallback.

### Audio will not transcribe

- Confirm the recording plays in the audio player.
- Try a common format such as MP3, WAV, M4A or WebM.
- Make sure the speech is clear and louder than background machinery.
- A transcript can always be pasted or uploaded manually.

### The downloaded file has the wrong extension

- Hard-refresh the application to load the latest JavaScript.
- The current version creates a named `application/json` file and delays temporary URL cleanup for Safari compatibility.

## Privacy and safety

- Obtain consent from every participant before recording.
- Review transcripts and extracted fields before submitting a service ticket.
- Do not rely on the application alone for safety-critical decisions.
- Treat machine isolation, lockout and emergency procedures as site-controlled processes.

## Technology

- HTML5
- CSS3
- Vanilla JavaScript
- Browser `MediaRecorder`, Web Audio and Speech Synthesis APIs
- [Transformers.js](https://github.com/huggingface/transformers.js)
- Open-source Whisper speech recognition
- GitHub
- Vercel static hosting

## Status

This is a working prototype. The next major step is authenticated D365/Dataverse submission with organisation-specific field mapping and validation.
