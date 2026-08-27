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
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const player = document.getElementById('audioPlayer');
      player.src = URL.createObjectURL(blob);
      player.hidden = false;
      stream.getTracks().forEach(t => t.stop());
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
document.getElementById('demoAudioBtn').addEventListener('click', () => { showToast('Demo transcript is available in step 02'); });
document.getElementById('textUpload').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  document.getElementById('transcript').value = await file.text();
  showToast('Transcript loaded');
});
document.getElementById('audioUpload').addEventListener('change', e => {
  const file = e.target.files?.[0]; if (!file) return;
  const player = document.getElementById('audioPlayer');
  player.src = URL.createObjectURL(file); player.hidden = false;
  showToast('Recording loaded');
});
document.getElementById('generateBtn').addEventListener('click', () => {
  const text = document.getElementById('transcript').value.trim();
  currentTicket = text ? structureTranscript(text) : emptyTicket();
  renderTicket();
  document.querySelector('.output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('copyBtn').addEventListener('click', async () => {
  const plain = Object.fromEntries(fields.map(([key]) => [key, currentTicket[key]]));
  try { await navigator.clipboard.writeText(JSON.stringify(plain, null, 2)); showToast('JSON copied to clipboard'); }
  catch { showToast('Clipboard unavailable'); }
});

renderTicket();
