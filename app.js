const fields = [
  ['customer', 'Customer'],
  ['mine_site', 'Mine site'],
  ['caller', 'Caller'],
  ['machine_model', 'Machine model'],
  ['machine_serial', 'Machine serial'],
  ['equipment_hours', 'Equipment hours'],
  ['fault_description', 'Fault description'],
  ['fault_codes', 'Fault codes'],
  ['machine_status', 'Machine status'],
  ['safety_risk', 'Safety risk'],
  ['troubleshooting_completed', 'Troubleshooting completed'],
  ['recommended_actions', 'Recommended actions'],
  ['call_summary', 'Call summary']
];

const demoTranscript = `Bill: Normet technical support, Bill speaking.
Tom: Hi Bill, Tom Hayes from Olympic Dam underground maintenance. We have an issue with a Normet Charmec MC 605, serial MC605-2187. The machine has 4,382 hours.
Bill: What is it doing?
Tom: The boom won't extend. Operator gets fault code E214 hydraulic pressure low. The machine is parked in the workshop and isolated, so there is no immediate safety risk.
Bill: What have you checked so far?
Tom: We checked the hydraulic oil level, inspected the obvious hoses for leaks and power-cycled the control system. Oil level is normal and we can't see any external leak. The E214 code returns as soon as boom extend is commanded.
Bill: Okay. Leave the machine isolated. Next step is to check the boom extension pressure sensor connector and measure the pressure signal. If the connector is clean and secure, we'll need the pressure reading before deciding whether the sensor or hydraulic circuit is at fault.
Tom: No worries. I'll get our auto electrician onto the connector and call back with the pressure reading.
Bill: Great. I'll note it against Olympic Dam and the MC 605.`;

let currentTicket = emptyTicket();
let mediaRecorder = null;
let chunks = [];
let startedAt = 0;
let timerId = null;
let whisperPipeline = null;
let demoIsPlaying = false;

const WHISPER_MODEL = 'onnx-community/whisper-tiny.en';
const TRANSFORMERS_JS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

function emptyTicket() {
  return Object.fromEntries(fields.map(([key]) => [key, { value: 'Not discussed', evidence: 'Not discussed' }]));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function renderTicket() {
  const grid = document.getElementById('ticketGrid');
  grid.innerHTML = fields.map(([key, label]) => {
    const item = currentTicket[key] || { value: 'Not discussed', evidence: 'Not discussed' };
    const discussed = item.value !== 'Not discussed';
    return `<article class="ticket-card">
      <div class="ticket-label-row"><div class="ticket-label">${label}</div><div class="ticket-state">${discussed ? 'Evidence found' : 'Not discussed'}</div></div>
      <div class="ticket-value">${escapeHtml(item.value)}</div>
      <div class="ticket-evidence-label">Supporting transcript</div>
      <div class="ticket-evidence">“${escapeHtml(item.evidence)}”</div>
    </article>`;
  }).join('');
}

function clean(s) { return s?.replace(/^[:\s-]+|[\s.,;]+$/g, '').trim(); }
function evidenceFor(text, rx) {
  const lines = text.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const line = lines.find(l => rx.test(l));
  return line || 'Not discussed';
}
function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return clean(m[1]);
  }
  return null;
}
function setIf(ticket, key, value, evidence) {
  if (value) ticket[key] = { value, evidence: evidence || value };
}

function structureTranscript(text) {
  const t = emptyTicket();
  const lower = text.toLowerCase();

  const customer = firstMatch(text, [/from\s+([A-Z][A-Za-z0-9 &.'-]{2,50}?)(?:\.|,|\n| underground| maintenance)/i, /customer(?: is|:)?\s*([^\n.]+)/i]);
  setIf(t, 'customer', customer, evidenceFor(text, /from|customer/i));

  const site = firstMatch(text, [/from\s+([A-Z][A-Za-z0-9 &.'-]{2,50}?)(?: underground| mine| site)/i, /(?:mine site|site)(?: is|:)?\s*([^\n.]+)/i]);
  setIf(t, 'mine_site', site, evidenceFor(text, /underground|mine site|site/i));

  const caller = firstMatch(text, [/(?:^|\n)(?:caller\s*:\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*:\s*(?:Hi|Hello|Hey)/m, /(?:this is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i]);
  setIf(t, 'caller', caller, evidenceFor(text, /Hi |Hello|this is|i'm|i am/i));

  const model = firstMatch(text, [/(?:Normet\s+)?((?:Charmec|Spraymec|Variomec|Multimec|Scamec|Utimec|Himec|Utilift|Agitator|Concrete Mixer)[^,.;\n]{0,28})/i, /(?:machine model|model)(?: is|:)?\s*([^,.;\n]+)/i]);
  setIf(t, 'machine_model', model, evidenceFor(text, /Charmec|Spraymec|Variomec|Multimec|Scamec|Utimec|Himec|Utilift|machine model|model/i));

  const serial = firstMatch(text, [/(?:serial(?: number| no\.?| #)?|s\/n)(?: is|:)?\s*([A-Z0-9-]{4,})/i]);
  setIf(t, 'machine_serial', serial, evidenceFor(text, /serial|s\/n/i));

  const hours = firstMatch(text, [/(?:has|on|at)?\s*([\d,]{2,7})\s*(?:hours|hrs)/i, /(?:equipment hours|machine hours)(?: is|:)?\s*([\d,]+)/i]);
  setIf(t, 'equipment_hours', hours ? `${hours} hours` : null, evidenceFor(text, /hours|hrs/i));

  const faultLine = text.split(/\n+/).find(l => /issue|fault|won't|will not|not working|problem|error|failure|stopped|can't|cannot/i.test(l) && !/what is it doing/i.test(l));
  setIf(t, 'fault_description', faultLine ? clean(faultLine.replace(/^[^:]+:\s*/, '')) : null, faultLine);

  const codes = [...text.matchAll(/(?:fault|error)?\s*code\s*([A-Z]{0,3}-?\d{2,5})/ig)].map(m => m[1].toUpperCase());
  setIf(t, 'fault_codes', codes.length ? [...new Set(codes)].join(', ') : null, evidenceFor(text, /code/i));

  const statusLine = text.split(/\n+/).find(l => /parked|isolated|running|operational|down|stopped|workshop|out of service/i.test(l));
  setIf(t, 'machine_status', statusLine ? clean(statusLine.replace(/^[^:]+:\s*/, '')) : null, statusLine);

  const safetyLine = text.split(/\n+/).find(l => /safety risk|safe|unsafe|isolated|lockout|tagged out/i.test(l));
  if (safetyLine) {
    const value = /no (?:immediate )?safety risk|no safety|safe/i.test(safetyLine) ? 'No immediate safety risk stated' : clean(safetyLine.replace(/^[^:]+:\s*/, ''));
    setIf(t, 'safety_risk', value, safetyLine);
  }

  const troubleLines = text.split(/\n+/).filter(l => /checked|inspected|power-cycled|power cycled|tested|replaced|reset|measured|confirmed|oil level/i.test(l));
  if (troubleLines.length) setIf(t, 'troubleshooting_completed', troubleLines.map(l => clean(l.replace(/^[^:]+:\s*/, ''))).join(' '), troubleLines.slice(0,2).join(' / '));

  const actionLines = text.split(/\n+/).filter(l => /next step|need to|leave the machine|check the|measure|call back|recommend|should/i.test(l));
  if (actionLines.length) setIf(t, 'recommended_actions', actionLines.map(l => clean(l.replace(/^[^:]+:\s*/, ''))).join(' '), actionLines.slice(0,2).join(' / '));

  const discussed = [];
  if (t.machine_model.value !== 'Not discussed') discussed.push(t.machine_model.value);
  if (t.fault_description.value !== 'Not discussed') discussed.push(t.fault_description.value);
  if (t.fault_codes.value !== 'Not discussed') discussed.push(`code ${t.fault_codes.value}`);
  if (discussed.length) {
    t.call_summary = { value: discussed.join(' — '), evidence: t.fault_description.evidence };
  }
  return t;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

function setTranscriptionStatus(message, progress = null, state = 'working') {
  const box = document.getElementById('transcriptionStatus');
  const label = document.getElementById('transcriptionLabel');
  const bar = document.getElementById('transcriptionProgress');
  box.hidden = false;
  box.dataset.state = state;
  label.textContent = message;
  if (progress === null) bar.removeAttribute('value');
  else bar.value = Math.max(0, Math.min(100, progress));
}

function hideTranscriptionStatus() {
  document.getElementById('transcriptionStatus').hidden = true;
}

async function getWhisperPipeline() {
  if (whisperPipeline) return whisperPipeline;

  setTranscriptionStatus('Loading the open-source Whisper model…', 0);
  const { pipeline, env } = await import(TRANSFORMERS_JS_URL);
  env.useBrowserCache = true;

  const useWebGpu = Boolean(navigator.gpu);
  whisperPipeline = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
    device: useWebGpu ? 'webgpu' : 'wasm',
    ...(useWebGpu ? {} : { dtype: 'q8' }),
    progress_callback: info => {
      if (typeof info.progress === 'number') {
        setTranscriptionStatus(`Loading Whisper: ${Math.round(info.progress)}%`, info.progress);
      }
    }
  });
  return whisperPipeline;
}

async function decodeAudioTo16kMono(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio decoding is not supported in this browser.');

  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * 16000));
    const offline = new OfflineAudioContext(1, length, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await context.close().catch(() => {});
  }
}

async function transcribeAudio(blob) {
  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;
  setTranscriptionStatus('Preparing audio…', null);

  try {
    const [transcriber, audio] = await Promise.all([getWhisperPipeline(), decodeAudioTo16kMono(blob)]);
    setTranscriptionStatus('Transcribing locally in your browser…', null);
    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'english',
      task: 'transcribe'
    });
    const text = String(result?.text || '').trim();
    if (!text) throw new Error('No speech was detected in this recording.');
    document.getElementById('transcript').value = text;
    setTranscriptionStatus('Transcription ready. Review it, then generate the ticket.', 100, 'ready');
    showToast('Recording transcribed');
  } catch (error) {
    console.error('[transcription] failed', error);
    setTranscriptionStatus(`Could not transcribe: ${error?.message || 'unknown browser error'}`, 0, 'error');
    showToast('Transcription failed — you can still paste a transcript');
  } finally {
    generateBtn.disabled = false;
  }
}

async function getAustralianVoices() {
  let voices = speechSynthesis.getVoices();
  if (!voices.length) {
    await Promise.race([
      new Promise(resolve => speechSynthesis.addEventListener('voiceschanged', resolve, { once: true })),
      new Promise(resolve => setTimeout(resolve, 700))
    ]);
    voices = speechSynthesis.getVoices();
  }
  const australian = voices.filter(voice => /^en-AU$/i.test(voice.lang));
  const english = voices.filter(voice => /^en-/i.test(voice.lang));
  const pool = australian.length >= 2 ? australian : [...australian, ...english];
  return [pool[0] || null, pool.find(voice => voice !== pool[0]) || pool[0] || null];
}

function speakLine(text, voice, pitch) {
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-AU';
    utterance.voice = voice;
    utterance.rate = 0.9;
    utterance.pitch = pitch;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

async function playDemoCall() {
  const button = document.getElementById('demoAudioBtn');
  if (!('speechSynthesis' in window)) {
    document.getElementById('transcript').value = demoTranscript;
    showToast('Demo transcript loaded; speech playback is unavailable');
    return;
  }

  if (demoIsPlaying) {
    speechSynthesis.cancel();
    demoIsPlaying = false;
    button.textContent = 'Load demo recording';
    hideTranscriptionStatus();
    return;
  }

  speechSynthesis.cancel();
  document.getElementById('transcript').value = demoTranscript;
  currentTicket = structureTranscript(demoTranscript);
  renderTicket();
  document.getElementById('generateBtn').disabled = false;

  demoIsPlaying = true;
  button.textContent = 'Stop demo recording';
  setTranscriptionStatus('Playing the built-in two-speaker Australian demo call…', null, 'ready');
  const [billVoice, tomVoice] = await getAustralianVoices();
  const lines = demoTranscript.split('\n').filter(Boolean);

  for (const line of lines) {
    if (!demoIsPlaying) break;
    const [speaker, ...words] = line.split(':');
    await speakLine(words.join(':').trim(), speaker === 'Bill' ? billVoice : tomVoice, speaker === 'Bill' ? 0.92 : 1.04);
    await new Promise(resolve => setTimeout(resolve, 220));
  }

  demoIsPlaying = false;
  button.textContent = 'Replay demo recording';
  setTranscriptionStatus('Demo complete. The transcript and ticket are ready.', 100, 'ready');
}

async function toggleRecording() {
  const btn = document.getElementById('recordBtn');
  const label = document.getElementById('recordLabel');
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    clearInterval(timerId);
    btn.classList.remove('recording');
    label.textContent = 'Recording captured';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast('Recording is not supported in this browser');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const player = document.getElementById('audioPlayer');
      player.src = URL.createObjectURL(blob);
      player.hidden = false;
      stream.getTracks().forEach(t => t.stop());
      await transcribeAudio(blob);
    };
    mediaRecorder.start();
    startedAt = Date.now();
    btn.classList.add('recording');
    label.textContent = 'Recording… tap to stop';
    timerId = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt)/1000);
      document.getElementById('timer').textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }, 250);
  } catch (err) {
    showToast('Microphone permission was not granted');
  }
}

document.getElementById('recordBtn').addEventListener('click', toggleRecording);
document.getElementById('demoBtn').addEventListener('click', () => { document.getElementById('transcript').value = demoTranscript; showToast('Demo transcript loaded'); });
document.getElementById('demoAudioBtn').addEventListener('click', playDemoCall);
document.getElementById('textUpload').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  document.getElementById('transcript').value = await file.text();
  showToast('Transcript loaded');
});
document.getElementById('audioUpload').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  const player = document.getElementById('audioPlayer');
  player.src = URL.createObjectURL(file); player.hidden = false;
  showToast('Recording loaded');
  await transcribeAudio(file);
});
document.getElementById('generateBtn').addEventListener('click', () => {
  const text = document.getElementById('transcript').value.trim();
  currentTicket = text ? structureTranscript(text) : emptyTicket();
  renderTicket();
  document.querySelector('.output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function getTicketPayload() {
  return {
    schema_version: '1.0',
    source: 'bills-ticket-tool',
    target: 'd365_customer_service',
    generated_at: new Date().toISOString(),
    ...Object.fromEntries(fields.map(([key]) => [key, currentTicket[key]]))
  };
}

document.getElementById('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(getTicketPayload(), null, 2)); showToast('JSON copied to clipboard'); }
  catch { showToast('Clipboard unavailable'); }
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  const payload = getTicketPayload();
  const serial = currentTicket.machine_serial?.value;
  const suffix = serial && serial !== 'Not discussed'
    ? serial.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
    : new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bills-ticket-${suffix}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Ticket JSON downloaded');
});

renderTicket();
