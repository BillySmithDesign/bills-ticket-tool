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

// Fictional data used only to demonstrate the workflow.
const demoTranscript = `Bill: Technical support, Bill speaking.
Demo caller: Hi Bill, this is the demo caller from Example Mine underground maintenance. This is a fictional test call. We have an issue with a Charmec MC 605 training unit, serial DEMO-0001. The machine has 4,382 hours.
Bill: What is it doing?
Demo caller: The boom won't extend. The test operator gets fault code E214 hydraulic pressure low. The training unit is parked in the workshop and isolated, so there is no immediate safety risk.
Bill: What have you checked so far?
Demo caller: We checked the hydraulic oil level, inspected the obvious hoses for leaks and power-cycled the control system. Oil level is normal and we can't see any external leak. The E214 code returns as soon as boom extend is commanded.
Bill: Okay. Leave the machine isolated. Next step is to check the boom extension pressure sensor connector and measure the pressure signal. If the connector is clean and secure, we'll need the pressure reading before deciding whether the sensor or hydraulic circuit is at fault.
Demo caller: No worries. I'll get the demo electrician onto the connector and call back with the pressure reading.
Bill: Great. I'll note it against Example Mine and the training unit.`;

let currentTicket = emptyTicket();
let mediaRecorder = null;
let chunks = [];
let startedAt = 0;
let timerId = null;
let demoIsPlaying = false;
let ticketGeneratedAt = new Date().toISOString();
let processingMetadata = { transcription: null, interpretation: null };

const API_STORAGE_KEY = 'bills_ticket_api_base';

function getApiBase() {
  return String(localStorage.getItem(API_STORAGE_KEY) || '').trim().replace(/\/$/, '');
}

function normaliseApiBase(value) {
  const trimmed = String(value || '').trim().replace(/\/$/, '');
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Use the HTTPS Tailscale address for BIGRIG.');
  }
  return url.toString().replace(/\/$/, '');
}

function setConnectionState(state, message) {
  const dot = document.getElementById('connectionDot');
  const status = document.getElementById('connectionStatus');
  const headerDot = document.getElementById('headerStatusDot');
  const headerText = document.getElementById('headerStatusText');
  dot.dataset.state = state;
  status.textContent = message;
  headerDot.className = `status-dot ${state === 'ready' ? '' : state === 'error' ? 'error' : 'offline'}`.trim();
  headerText.textContent = state === 'ready' ? 'BIGRIG AI connected' : state === 'working' ? 'Checking BIGRIG…' : 'Local AI not connected';
}

async function apiRequest(path, options = {}) {
  const base = getApiBase();
  if (!base) throw new Error('Enter and save the BIGRIG Tailscale address first.');
  let response;
  try {
    response = await fetch(`${base}${path}`, options);
  } catch {
    throw new Error('Could not reach BIGRIG. Confirm Tailscale is connected and the local AI stack is running.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `BIGRIG returned HTTP ${response.status}.`);
  return payload;
}

async function checkAiConnection() {
  if (!getApiBase()) {
    setConnectionState('offline', 'Enter the private Tailscale API address');
    return false;
  }
  setConnectionState('working', 'Checking Deepgram and local Qwen…');
  try {
    const health = await apiRequest('/health');
    if (!health.ok) throw new Error('The AI service is not ready.');
    setConnectionState('ready', `Ready · Deepgram + ${health.model}`);
    return true;
  } catch (error) {
    setConnectionState('error', error.message);
    return false;
  }
}

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
  renderRawJson();
}

function markTicketUpdated() {
  ticketGeneratedAt = new Date().toISOString();
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

async function transcribeAudio(blob) {
  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;
  setTranscriptionStatus('Sending recording securely through BIGRIG to Deepgram…', null);

  try {
    const result = await apiRequest('/v1/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob
    });
    const text = String(result?.transcript || '').trim();
    if (!text) throw new Error('No speech was detected in this recording.');
    document.getElementById('transcript').value = text;
    processingMetadata.transcription = { provider: result.provider, model: result.model, request_id: result.request_id };
    setTranscriptionStatus('Deepgram transcription ready. Review it, then generate the AI ticket.', 100, 'ready');
    showToast('Deepgram transcription ready');
  } catch (error) {
    console.error('[transcription] failed', error);
    setTranscriptionStatus(`Could not transcribe: ${error?.message || 'unknown error'}`, 0, 'error');
    showToast('Transcription failed — you can still paste a transcript');
  } finally {
    generateBtn.disabled = false;
  }
}

async function generateStructuredTicket(text, { scroll = true } = {}) {
  if (!text) {
    currentTicket = emptyTicket();
    renderTicket();
    showToast('Add a transcript first');
    return;
  }
  const button = document.getElementById('generateBtn');
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Local AI is interpreting the call…';
  document.getElementById('processingNote').textContent = 'Qwen is interpreting the transcript and validating evidence…';
  try {
    const result = await apiRequest('/v1/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: text })
    });
    currentTicket = result.ticket || emptyTicket();
    processingMetadata.interpretation = { provider: result.provider, model: result.model, chunks_processed: result.chunks_processed };
    markTicketUpdated();
    renderTicket();
    document.getElementById('processingNote').textContent = `Interpreted locally by ${result.model}; every populated field passed transcript-evidence validation.`;
    if (scroll) document.querySelector('.output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('AI ticket generated');
  } catch (error) {
    console.error('[interpretation] failed', error);
    document.getElementById('processingNote').textContent = `AI interpretation unavailable: ${error.message}`;
    showToast(error.message);
    throw error;
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
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
  document.getElementById('generateBtn').disabled = false;
  generateStructuredTicket(demoTranscript, { scroll: false }).catch(() => {});

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
  setTranscriptionStatus('Demo playback complete. The transcript is ready.', 100, 'ready');
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
document.getElementById('generateBtn').addEventListener('click', async () => {
  const text = document.getElementById('transcript').value.trim();
  await generateStructuredTicket(text).catch(() => {});
});

function getTicketPayload() {
  return {
    schema_version: '1.1',
    source: 'bills-ticket-tool',
    target: 'd365_customer_service',
    generated_at: ticketGeneratedAt,
    processing: processingMetadata,
    ...Object.fromEntries(fields.map(([key]) => [key, currentTicket[key]]))
  };
}

function renderRawJson() {
  const output = document.getElementById('rawJsonOutput');
  if (output) output.textContent = JSON.stringify(getTicketPayload(), null, 2);
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
  const filename = `bills-ticket-${suffix}.json`;
  const json = JSON.stringify(payload, null, 2);
  const file = new File([json], filename, { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.type = 'application/json';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  showToast('Ticket JSON downloaded');
});

document.getElementById('saveApiBtn').addEventListener('click', async () => {
  try {
    const value = normaliseApiBase(document.getElementById('apiBaseUrl').value);
    if (!value) throw new Error('Enter the BIGRIG Tailscale address.');
    localStorage.setItem(API_STORAGE_KEY, value);
    await checkAiConnection();
  } catch (error) {
    setConnectionState('error', error.message);
  }
});

document.getElementById('connectionShortcut').addEventListener('click', () => {
  document.querySelector('.connection-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('apiBaseUrl').focus();
});

document.getElementById('apiBaseUrl').value = getApiBase();
renderTicket();
checkAiConnection();
