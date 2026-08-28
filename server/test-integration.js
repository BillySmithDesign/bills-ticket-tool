import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.DEEPGRAM_API_KEY = 'test-key';
process.env.DEEPGRAM_API_URL = 'https://mock.deepgram.test/listen';
process.env.OLLAMA_URL = 'http://mock-ollama.test';

const transcript = 'Speaker 1: This fictional training unit is a Charmec MC 605, serial DEMO-0001, with 4,382 hours.\nSpeaker 2: The boom will not extend and fault code E214 appears.';
const fields = [
  'customer', 'mine_site', 'caller', 'machine_model', 'machine_serial',
  'equipment_hours', 'fault_description', 'fault_codes', 'machine_status',
  'safety_risk', 'troubleshooting_completed', 'recommended_actions', 'call_summary'
];
const blank = () => ({ value: 'Not discussed', evidence: 'Not discussed', confidence: 0 });

globalThis.fetch = async url => {
  const href = String(url);
  if (href.startsWith('https://mock.deepgram.test/listen')) {
    return Response.json({
      metadata: { request_id: 'mock-deepgram-request' },
      results: { utterances: [
        { speaker: 0, transcript: 'This fictional training unit is a Charmec MC 605, serial DEMO-0001, with 4,382 hours.' },
        { speaker: 1, transcript: 'The boom will not extend and fault code E214 appears.' }
      ] }
    });
  }
  if (href === 'http://mock-ollama.test/api/tags') {
    return Response.json({ models: [{ name: 'qwen2.5:7b' }] });
  }
  if (href === 'http://mock-ollama.test/api/chat') {
    const ticket = Object.fromEntries(fields.map(field => [field, blank()]));
    ticket.fault_description = {
      value: 'Boom extension is unavailable and E214 is displayed.',
      evidence: 'Speaker 2: The boom will not extend and fault code E214 appears.',
      confidence: 0.98
    };
    ticket.call_summary = {
      value: 'The Charmec MC 605 has a boom-extension fault accompanied by E214.',
      evidence: 'Speaker 2: The boom will not extend and fault code E214 appears.',
      confidence: 0.95
    };
    return Response.json({ message: { content: JSON.stringify(ticket) } });
  }
  throw new Error(`Unexpected mock request: ${href}`);
};

const { transcribeAudio, interpretTranscript, health } = await import('./server.js');

const audioRequest = Readable.from([Buffer.from('mock audio')]);
audioRequest.headers = { 'content-type': 'audio/wav' };
const transcription = await transcribeAudio(audioRequest);
assert.equal(transcription.transcript, transcript);
assert.equal(transcription.provider, 'deepgram');

const jsonRequest = Readable.from([Buffer.from(JSON.stringify({ transcript }))]);
const interpretation = await interpretTranscript(jsonRequest);
assert.equal(interpretation.ticket.machine_serial.value, 'DEMO-0001');
assert.equal(interpretation.ticket.equipment_hours.value, '4,382 hours');
assert.equal(interpretation.ticket.fault_codes.value, 'E214');
assert.match(interpretation.ticket.call_summary.value, /boom-extension fault/i);

const status = await health();
assert.equal(status.ok, true);
console.log('Integration test passed: Deepgram transcription -> Ollama interpretation -> validated ticket.');
