import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const DEEPGRAM_API_URL = process.env.DEEPGRAM_API_URL || 'https://api.deepgram.com/v1/listen';
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || 'nova-3';
const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || 'en-AU';
const DEEPGRAM_KEYTERMS = (process.env.DEEPGRAM_KEYTERMS || 'Normet|Charmec|Spraymec|Variomec|Multimec|Scamec|Utimec|Himec|Utilift')
  .split('|').map(value => value.trim()).filter(Boolean).slice(0, 100);
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 8192);
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 100 * 1024 * 1024);
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 2 * 1024 * 1024);
const MAX_CHUNK_CHARS = Number(process.env.MAX_CHUNK_CHARS || 12000);
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://bill-support.vercel.app,http://localhost:8080')
  .split(',').map(value => value.trim()).filter(Boolean));

const fieldNames = [
  'customer', 'mine_site', 'caller', 'machine_model', 'machine_serial',
  'equipment_hours', 'fault_description', 'fault_codes', 'machine_status',
  'safety_risk', 'troubleshooting_completed', 'recommended_actions', 'call_summary'
];

const fieldItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: 'string' },
    evidence: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  },
  required: ['value', 'evidence', 'confidence']
};

const ticketSchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(fieldNames.map(name => [name, fieldItemSchema])),
  required: fieldNames
};

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Max-Age', '86400');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error(`Request exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function requireAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    const error = new Error('This website origin is not allowed to use the AI service.');
    error.status = 403;
    throw error;
  }
}

function formatDeepgramTranscript(payload) {
  const utterances = payload?.results?.utterances || [];
  if (utterances.length) {
    return utterances
      .map(item => `Speaker ${Number(item.speaker ?? 0) + 1}: ${String(item.transcript || '').trim()}`)
      .filter(line => !line.endsWith(':'))
      .join('\n');
  }
  return String(payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
}

export async function transcribeAudio(request) {
  if (!DEEPGRAM_API_KEY) {
    const error = new Error('DEEPGRAM_API_KEY is not configured on BIGRIG.');
    error.status = 503;
    throw error;
  }
  const audio = await readBody(request, MAX_AUDIO_BYTES);
  if (!audio.length) {
    const error = new Error('No audio was received.');
    error.status = 400;
    throw error;
  }

  const url = new URL(DEEPGRAM_API_URL);
  const options = {
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    smart_format: 'true',
    diarize: 'true',
    utterances: 'true',
    punctuate: 'true',
    paragraphs: 'true'
  };
  for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value);
  for (const keyterm of DEEPGRAM_KEYTERMS) url.searchParams.append('keyterm', keyterm);

  const deepgramResponse = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': request.headers['content-type'] || 'application/octet-stream'
    },
    body: audio,
    signal: AbortSignal.timeout(180_000)
  });
  const payload = await deepgramResponse.json().catch(() => ({}));
  if (!deepgramResponse.ok) {
    const message = payload?.err_msg || payload?.error || `Deepgram returned HTTP ${deepgramResponse.status}.`;
    const error = new Error(message);
    error.status = 502;
    throw error;
  }
  const transcript = formatDeepgramTranscript(payload);
  if (!transcript) {
    const error = new Error('Deepgram did not detect speech in this recording.');
    error.status = 422;
    throw error;
  }
  return {
    transcript,
    provider: 'deepgram',
    model: DEEPGRAM_MODEL,
    request_id: payload?.metadata?.request_id || null
  };
}

function transcriptLines(transcript) {
  return transcript.split(/\n+/).map(line => line.trim()).filter(Boolean);
}

function evidenceLine(transcript, regex) {
  return transcriptLines(transcript).find(line => regex.test(line)) || 'Not discussed';
}

function extractExactFacts(transcript) {
  const facts = {};
  const serial = transcript.match(/(?:serial(?: number| no\.?| #)?|s\/n)(?: is|:)?\s*([A-Z0-9-]{4,})/i);
  if (serial) facts.machine_serial = { value: serial[1].toUpperCase(), evidence: evidenceLine(transcript, /serial|s\/n/i), confidence: 1 };

  const hours = transcript.match(/(?:has|on|at)?\s*([\d,]{2,7})\s*(?:hours|hrs)/i);
  if (hours) facts.equipment_hours = { value: `${hours[1]} hours`, evidence: evidenceLine(transcript, /hours|hrs/i), confidence: 1 };

  const codes = [...transcript.matchAll(/(?:fault|error)?\s*code\s*([A-Z]{0,3}-?\d{2,5})/ig)].map(match => match[1].toUpperCase());
  if (codes.length) facts.fault_codes = { value: [...new Set(codes)].join(', '), evidence: evidenceLine(transcript, /code/i), confidence: 1 };

  const model = transcript.match(/(?:Normet\s+)?((?:Charmec|Spraymec|Variomec|Multimec|Scamec|Utimec|Himec|Utilift)[^,.;\n]{0,28})/i);
  if (model) facts.machine_model = { value: model[1].trim(), evidence: evidenceLine(transcript, /Charmec|Spraymec|Variomec|Multimec|Scamec|Utimec|Himec|Utilift/i), confidence: 1 };
  return facts;
}

function splitTranscript(transcript) {
  const lines = transcriptLines(transcript);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    current += `${current ? '\n' : ''}${line}`;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [transcript];
}

function normaliseText(value) {
  return String(value || '').toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
}

function validatedItem(item, transcript) {
  const empty = { value: 'Not discussed', evidence: 'Not discussed', confidence: 0 };
  if (!item || typeof item.value !== 'string' || item.value.trim().toLowerCase() === 'not discussed') return empty;
  if (typeof item.evidence !== 'string' || !item.evidence.trim()) return empty;
  const evidence = item.evidence.trim().replace(/^['“"]|['”"]$/g, '');
  if (!normaliseText(transcript).includes(normaliseText(evidence))) return empty;
  return {
    value: item.value.trim(),
    evidence,
    confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0))
  };
}

function emptyTicket() {
  return Object.fromEntries(fieldNames.map(name => [name, { value: 'Not discussed', evidence: 'Not discussed', confidence: 0 }]));
}

function mergeTickets(tickets) {
  const merged = emptyTicket();
  const aggregating = new Set(['fault_description', 'troubleshooting_completed', 'recommended_actions', 'call_summary']);
  for (const field of fieldNames) {
    const discussed = tickets.map(ticket => ticket[field]).filter(item => item?.value !== 'Not discussed');
    if (!discussed.length) continue;
    if (!aggregating.has(field) || discussed.length === 1) {
      merged[field] = discussed.sort((a, b) => b.confidence - a.confidence)[0];
      continue;
    }
    const values = [...new Set(discussed.map(item => item.value))];
    const evidence = [...new Set(discussed.map(item => item.evidence))].slice(0, 3);
    merged[field] = {
      value: values.join(' '),
      evidence: evidence.join(' / '),
      confidence: Math.min(...discussed.map(item => item.confidence))
    };
  }
  return merged;
}

async function interpretChunk(chunk) {
  const system = `You create evidence-backed service tickets from underground mining equipment support calls.
Return only JSON matching the supplied schema.
Rules:
- Interpret and concisely paraphrase the conversation. Do not copy whole transcript sentences into value fields.
- Evidence must be a short, exact, verbatim excerpt from the transcript chunk.
- If a fact was not discussed, use value "Not discussed", evidence "Not discussed", confidence 0.
- Never invent customer details, machine data, diagnoses, safety conditions, repairs, parts or actions.
- recommended_actions contains only actions agreed, requested or committed to during the call. Do not create new technical advice.
- troubleshooting_completed contains only work explicitly stated as already completed.
- Distinguish machine status from the reported fault.
- call_summary should be a concise professional summary of the issue, current status and agreed next step.
- confidence is between 0 and 1 and measures support from the transcript, not general plausibility.`;

  const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      format: ticketSchema,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Create the ticket from this transcript:\n\n${chunk}` }
      ],
      options: { temperature: 0.1, num_ctx: OLLAMA_NUM_CTX }
    }),
    signal: AbortSignal.timeout(300_000)
  });
  const payload = await ollamaResponse.json().catch(() => ({}));
  if (!ollamaResponse.ok) {
    const error = new Error(payload?.error || `Ollama returned HTTP ${ollamaResponse.status}.`);
    error.status = 502;
    throw error;
  }
  let ticket;
  try {
    ticket = JSON.parse(payload?.message?.content || '{}');
  } catch {
    const error = new Error('The local AI returned invalid JSON. Please try again.');
    error.status = 502;
    throw error;
  }
  return Object.fromEntries(fieldNames.map(name => [name, validatedItem(ticket[name], chunk)]));
}

export async function interpretTranscript(request) {
  const body = await readBody(request, MAX_JSON_BYTES);
  let input;
  try {
    input = JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('The request must contain valid JSON.');
    error.status = 400;
    throw error;
  }
  const transcript = String(input?.transcript || '').trim();
  if (!transcript) {
    const error = new Error('A transcript is required.');
    error.status = 400;
    throw error;
  }
  const chunks = splitTranscript(transcript);
  const partialTickets = [];
  for (const chunk of chunks) partialTickets.push(await interpretChunk(chunk));
  const ticket = mergeTickets(partialTickets);
  Object.assign(ticket, extractExactFacts(transcript));
  return { ticket, provider: 'ollama', model: OLLAMA_MODEL, chunks_processed: chunks.length };
}

export async function health() {
  let ollama = false;
  let model_available = false;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      ollama = true;
      const payload = await response.json();
      const wanted = OLLAMA_MODEL.split(':')[0];
      model_available = (payload?.models || []).some(model => model.name === OLLAMA_MODEL || model.name?.startsWith(`${wanted}:`));
    }
  } catch {}
  const ok = Boolean(DEEPGRAM_API_KEY && ollama && model_available);
  const error = !DEEPGRAM_API_KEY
    ? 'Deepgram is not configured on BIGRIG.'
    : !ollama
      ? 'Ollama is not responding on BIGRIG.'
      : !model_available
        ? `${OLLAMA_MODEL} has not finished downloading on BIGRIG.`
        : null;
  return {
    ok,
    error,
    deepgram_configured: Boolean(DEEPGRAM_API_KEY),
    ollama_connected: ollama,
    model: OLLAMA_MODEL,
    model_available
  };
}

const server = http.createServer(async (request, response) => {
  const requestId = randomUUID();
  setCors(request, response);
  response.setHeader('X-Request-Id', requestId);
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    requireAllowedOrigin(request);
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      const result = await health();
      sendJson(response, result.ok ? 200 : 503, result);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/transcribe') {
      const result = await transcribeAudio(request);
      sendJson(response, 200, result);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/interpret') {
      const result = await interpretTranscript(request);
      sendJson(response, 200, result);
      return;
    }
    sendJson(response, 404, { error: 'Not found', request_id: requestId });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error('[ticket-api]', { requestId, method: request.method, url: request.url, status, error: error?.message });
    sendJson(response, status, { error: error?.message || 'Unexpected server error.', request_id: requestId });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ticket-api] listening on 0.0.0.0:${PORT}`, {
      model: OLLAMA_MODEL,
      deepgramConfigured: Boolean(DEEPGRAM_API_KEY),
      allowedOrigins: [...ALLOWED_ORIGINS]
    });
  });
}
