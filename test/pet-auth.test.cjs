'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { inspect } = require('node:util');
const { createPetFetch } = require('../runtime/pet-auth.cjs');
const { PetBridge } = require('../runtime/pet-bridge.cjs');
const { loadSkin } = require('../runtime/skin-assets.cjs');
const { MenuController, OWNER, ENTER } = require('../runtime/menu-controller.cjs');
const { scopeFromEnv } = require('../runtime/pet-window-scope.cjs');

// All credentials/state below are synthetic and private to disposable fixtures.
// No real API, user config, authorization file, native process or desktop runs.
const base = 'http://127.0.0.1:31380/dsh-pet-7340';
const failure = 'Protected pet API request failed';
const credential = () => randomBytes(32).toString('base64url');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tableball-pet-auth-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtimeFile = path.join(directory, 'standalone-runtime.json');
  const state = { pid: 12345, port: 31380, token: credential(), pluginRoot: directory };
  state.settingsUrl = 'http://127.0.0.1:31380/standalone-ai/#token=' + state.token;
  const write = (value = state) => fs.writeFileSync(runtimeFile, JSON.stringify(value), { mode: 0o600 });
  return { directory, runtimeFile, state, write, env: { TABLEBALL_PET_RUNTIME_FILE: runtimeFile } };
}
const reply = value => ({ ok: true, status: 200, json: async () => value });
const header = (init, name) => new Headers(init.headers).get(name);
async function rejectsPrivate(action, state) {
  await assert.rejects(action, error => {
    assert.equal(error.message, failure);
    assert.equal(error.cause, undefined);
    const printed = inspect(error);
    if (state) {
      assert.equal(printed.includes(state.token), false);
      assert.equal(printed.includes(state.settingsUrl), false);
    }
    assert.equal(printed.includes('settingsUrl'), false);
    return true;
  });
}

test('legacy fetch passes input/init/response and failure identity unchanged', async () => {
  const input = new URL('https://example.invalid/legacy');
  const init = { method: 'PATCH', headers: { custom: 'kept' }, body: 'payload', redirect: 'manual' };
  const response = reply({ ok: true });
  const petFetch = createPetFetch('not parsed in legacy mode', { env: {}, fetchImpl: (url, options) => {
    assert.equal(url, input); assert.equal(options, init); return response;
  } });
  assert.equal(await petFetch(input, init), response);
  const error = new Error('legacy failure');
  await assert.rejects(createPetFetch(base, { env: {}, fetchImpl: async () => { throw error; } })(base), e => e === error);
});

test('legacy default fetch is looked up at request time, preserving injected global fakes', async t => {
  const petFetch = createPetFetch(base, { env: {} });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return reply({ ok: true }); });
  await petFetch(base);
  const bridge = new PetBridge({ base, env: {} });
  await bridge.reload();
  assert.equal(calls, 2);
});

test('protected fetch lazily reads official state and preserves request options without mutating them', async t => {
  const f = fixture(t), calls = [], response = reply({ ok: true });
  const petFetch = createPetFetch(base, { runtimeFile: f.runtimeFile, env: {}, fetchImpl: async (...args) => { calls.push(args); return response; } });
  assert.equal(fs.existsSync(f.runtimeFile), false);
  f.write();
  const input = new URL(base + '/position?pet=main');
  const signal = new AbortController().signal, body = new Uint8Array([1, 2, 3]);
  const init = { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'X-Custom': 'kept' }, body, signal, redirect: 'follow', cache: 'no-store' };
  assert.equal(await petFetch(input, init), response);
  const [url, options] = calls[0];
  assert.equal(url, input);
  assert.equal(options.method, 'POST'); assert.equal(options.body, body); assert.equal(options.signal, signal);
  assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
  assert.equal(header(options, 'x-dsh-pet-token'), f.state.token);
  assert.equal(header(options, 'content-type'), 'application/octet-stream');
  assert.equal(header(options, 'x-custom'), 'kept');
  assert.deepEqual(init.headers, { 'content-type': 'application/octet-stream', 'X-Custom': 'kept' });
  assert.equal(init.redirect, 'follow');
  assert.equal(String(url).includes(f.state.token), false);
});

test('protected fetch supports every HeadersInit form and Request inputs', async t => {
  const f = fixture(t); f.write();
  for (const original of [{ 'X-DSH-PET-TOKEN': 'stale', Accept: 'application/json' }, [['X-DSH-PET-TOKEN', 'stale'], ['Accept', 'application/json']], new Headers({ 'X-DSH-PET-TOKEN': 'stale', Accept: 'application/json' })]) {
    const petFetch = createPetFetch(base, { ...f, fetchImpl: async (_url, options) => {
      assert.equal(Array.isArray(options.headers), Array.isArray(original));
      assert.equal(options.headers instanceof Headers, original instanceof Headers);
      assert.equal(header(options, 'x-dsh-pet-token'), f.state.token);
      assert.equal(header(options, 'accept'), 'application/json'); return reply({});
    } });
    await petFetch(base + '/config', { headers: original });
    assert.equal(new Headers(original).get('x-dsh-pet-token'), 'stale');
  }
  const input = new Request(base + '/reload', { method: 'POST', body: 'test payload', headers: { 'content-type': 'text/plain' } });
  await createPetFetch(base, { ...f, fetchImpl: async (url, options) => {
    assert.equal(url, input); assert.equal(url.method, 'POST'); assert.equal(await url.text(), 'test payload');
    assert.equal(header(options, 'content-type'), 'text/plain');
    assert.equal(header(options, 'x-dsh-pet-token'), f.state.token); return reply({});
  } })(input);
});

test('runtime env opt-in and explicit runtimeFile override select only the requested fixture', async t => {
  const f = fixture(t); f.write(); let calls = 0;
  const fetchImpl = async (_url, init) => { calls++; assert.equal(header(init, 'x-dsh-pet-token'), f.state.token); return reply({}); };
  await createPetFetch(base, { env: f.env, fetchImpl })(base);
  await createPetFetch(base, { env: { TABLEBALL_PET_RUNTIME_FILE: path.join(f.directory, 'missing') }, runtimeFile: f.runtimeFile, fetchImpl })(base);
  assert.equal(calls, 2);
});

test('process env contract reaches bridge and skin without new caller plumbing', async t => {
  const f = fixture(t); f.write();
  const previous = process.env.TABLEBALL_PET_RUNTIME_FILE;
  process.env.TABLEBALL_PET_RUNTIME_FILE = f.runtimeFile;
  t.after(() => { if (previous === undefined) delete process.env.TABLEBALL_PET_RUNTIME_FILE; else process.env.TABLEBALL_PET_RUNTIME_FILE = previous; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(header(options, 'x-dsh-pet-token'), f.state.token);
    return url.includes('/thumb/') ? new Response(new Uint8Array(20)) : reply({ ok: true });
  });
  await new PetBridge({ base }).reload();
  await loadSkin({ pets: [{ id: 'main' }], animations: { idle: ['idle'] } }, 'main', base);
  assert.equal(calls.length, 2);
});

test('manifest is refreshed for rotating tokens and removed state never reuses cached credentials', async t => {
  const f = fixture(t); f.write(); const seen = [];
  const petFetch = createPetFetch(base, { ...f, fetchImpl: async (_url, init) => { seen.push(header(init, 'x-dsh-pet-token')); return reply({}); } });
  await petFetch(base);
  const rotated = { ...f.state, token: credential() }; rotated.settingsUrl = 'http://127.0.0.1:31380/standalone-ai/#token=' + rotated.token;
  f.write(rotated); await petFetch(base);
  assert.deepEqual(seen, [f.state.token, rotated.token]);
  fs.unlinkSync(f.runtimeFile);
  await rejectsPrivate(() => petFetch(base), rotated);
  assert.equal(seen.length, 2);
});

test('missing, malformed and invalid manifest fields fail closed with no private error snippets', async t => {
  const f = fixture(t); let calls = 0;
  const petFetch = createPetFetch(base, { ...f, fetchImpl: async () => { calls++; return reply({}); } });
  await rejectsPrivate(() => petFetch(base), f.state);
  fs.writeFileSync(f.runtimeFile, '{"token":"' + f.state.token + '","settingsUrl":' + f.state.settingsUrl, { mode: 0o600 });
  await rejectsPrivate(() => petFetch(base), f.state);
  for (const invalid of [null, [], {}, { ...f.state, pid: 0 }, { ...f.state, pid: '12345' }, { ...f.state, port: '31380' }, { ...f.state, port: 31381 }, { ...f.state, port: 0 }, { ...f.state, port: 65536 }, { ...f.state, token: '' }, { ...f.state, token: 'invalid\nheader' }, { ...f.state, pluginRoot: '' }, { ...f.state, settingsUrl: null }, { ...f.state, settingsUrl: 'https://example.invalid/standalone-ai/' }, { ...f.state, settingsUrl: 'http://127.0.0.1:31381/standalone-ai/' }, { ...f.state, settingsUrl: 'http://localhost:31380/standalone-ai/' }]) {
    f.write(invalid); await rejectsPrivate(() => petFetch(base), f.state);
  }
  for (const runtimeFile of ['', null, 123]) await rejectsPrivate(() => createPetFetch(base, { env: {}, runtimeFile, fetchImpl: async () => { calls++; } })(base), f.state);
  assert.equal(calls, 0);
});

test('protected credentials never leave the exact trusted base origin or matching manifest port', async t => {
  const f = fixture(t); f.write(); let calls = 0;
  const fetchImpl = async () => { calls++; return reply({}); };
  const petFetch = createPetFetch(base, { ...f, fetchImpl });
  for (const target of ['https://example.invalid/pet', 'http://127.0.0.1:31381/pet', 'http://localhost:31380/pet', 'http://[::1]:31380/pet', 'https://127.0.0.1:31380/pet', 'http://user:password@127.0.0.1:31380/pet', base + '#fragment']) await rejectsPrivate(() => petFetch(target), f.state);
  for (const trusted of ['http://example.invalid:31380/pet', 'http://127.0.0.1:31381/pet', 'http://127.0.0.1:31380/pet#fragment', 'http://127.0.0.1:31380/pet?token=not-allowed', 'not a URL']) await rejectsPrivate(() => createPetFetch(trusted, { ...f, fetchImpl })(trusted), f.state);
  assert.equal(calls, 0);
  await petFetch(base + '/config?pet=main');
  assert.equal(calls, 1);
});

test('protected fetch accepts supported loopback bases only with matching manifest origins', async t => {
  const f = fixture(t);
  for (const origin of ['http://127.0.0.1:31380', 'http://localhost:31380', 'http://[::1]:31380']) {
    f.write({ ...f.state, settingsUrl: origin + '/standalone-ai/#token=' + f.state.token });
    let calls = 0;
    await createPetFetch(origin + '/dsh-pet-7340', { ...f, fetchImpl: async (_url, init) => { calls++; assert.equal(header(init, 'x-dsh-pet-token'), f.state.token); return reply({}); } })(origin + '/dsh-pet-7340/config');
    assert.equal(calls, 1);
  }
});

test('redirects are forced off and redirect/followed responses or private fetch errors are sanitized', async t => {
  const f = fixture(t); f.write();
  for (const response of [new Response('', { status: 302, headers: { location: 'https://example.invalid/' } }), { ...reply({}), redirected: true }, { ...reply({}), url: 'http://127.0.0.1:31381/final' }]) {
    let calls = 0;
    await rejectsPrivate(() => createPetFetch(base, { ...f, fetchImpl: async (_url, init) => { calls++; assert.equal(init.redirect, 'error'); return response; } })(base, { redirect: 'follow' }), f.state);
    assert.equal(calls, 1);
  }
  await rejectsPrivate(() => createPetFetch(base, { ...f, fetchImpl: async () => { throw new Error(JSON.stringify(f.state)); } })(base), f.state);
});

test('bridge authenticates GET/POST/DELETE, retaining JSON payloads and timeout signals without public credentials', async t => {
  const f = fixture(t); f.write(); const calls = [];
  const bridge = new PetBridge({ base, env: f.env, fetchImpl: async (url, init) => { calls.push({ url, init }); return reply({ ok: true }); } });
  await bridge.request('/config'); await bridge.request('/menu/item', 'POST', { owner: OWNER }); await bridge.request('/menu/item?owner=' + OWNER, 'DELETE');
  assert.deepEqual(calls.map(c => c.init.method), ['GET', 'POST', 'DELETE']);
  for (const { url, init } of calls) {
    assert.equal(header(init, 'x-dsh-pet-token'), f.state.token); assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal); assert.equal(url.includes(f.state.token), false);
    assert.equal((init.body || '').includes(f.state.token), false);
  }
  assert.equal(header(calls[1].init, 'content-type'), 'application/json');
  assert.equal(calls[1].init.body, JSON.stringify({ owner: OWNER }));
  assert.equal(JSON.stringify(bridge).includes(f.state.token), false);
  assert.equal(JSON.stringify(bridge).includes(f.state.settingsUrl), false);
});

test('protected bridge sanitizes HTTP, API and JSON failures while legacy keeps its error contract', async t => {
  const f = fixture(t); f.write();
  for (const response of [{ ok: false, status: 403 }, reply({ ok: false, ...f.state }), reply({ error: f.state.token }), { ...reply({}), json: async () => { throw new SyntaxError(JSON.stringify(f.state)); } }]) {
    await rejectsPrivate(() => new PetBridge({ base, ...f, fetchImpl: async () => response }).request('/config'), f.state);
  }
  await assert.rejects(new PetBridge({ base, env: {}, fetchImpl: async () => reply({ error: 'legacy rejection' }) }).request('/config'), /legacy rejection/);
});

test('skin media valid flow authenticates GET without exposing capability in the returned payload', async t => {
  const f = fixture(t); f.write(); const bytes = new Uint8Array(20).fill(7);
  const config = { main: { pets: [{ id: 'main', name: 'Fixture pet', assetRoot: 'fixture' }], animations: { idle: ['呼吸'] } } };
  let calls = 0;
  const skin = await loadSkin(config, 'main', base, { env: f.env, fetcher: async (url, init) => {
    calls++; assert.equal(url, base + '/thumb/fixture/' + encodeURIComponent('呼吸') + '.webm');
    assert.equal(init.method, undefined); assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    assert.equal(header(init, 'x-dsh-pet-token'), f.state.token);
    return new Response(bytes, { headers: { 'content-length': '20', 'content-type': 'video/webm' } });
  } });
  assert.equal(calls, 1); assert.deepEqual(skin.bytes, bytes); assert.equal(skin.name, 'Fixture pet');
  assert.equal(JSON.stringify(skin).includes(f.state.token), false);
  assert.equal(JSON.stringify(skin).includes(f.state.settingsUrl), false);
});

test('skin fails closed before fetching missing state and sanitizes private stream errors', async t => {
  const f = fixture(t), config = { pets: [{ id: 'main' }], animations: { idle: ['idle'] } }; let calls = 0;
  await rejectsPrivate(() => loadSkin(config, 'main', base, { env: f.env, fetcher: async () => { calls++; } }), f.state);
  assert.equal(calls, 0); f.write();
  await rejectsPrivate(() => loadSkin(config, 'main', base, { env: f.env, fetcher: async () => ({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read: async () => { throw new Error(JSON.stringify(f.state)); } }) } }) }), f.state);
});

test('menu registration, event polling and unregister all use authenticated bridge requests', async t => {
  const f = fixture(t); f.write(); const calls = []; let controller;
  controller = new MenuController({ base, env: f.env, log: () => {}, fetchImpl: async (url, init) => {
    calls.push({ url, init }); assert.equal(header(init, 'x-dsh-pet-token'), f.state.token);
    if (url.includes('/menu/events?')) { controller.closed = true; return reply({ events: {} }); }
    return reply({ ok: true });
  } });
  await controller.run(); controller.closed = false; await controller.dispose();
  assert.deepEqual(calls.map(c => c.init.method), ['POST', 'GET', 'DELETE']);
  assert.deepEqual(JSON.parse(calls[0].init.body), { owner: OWNER, target: 'desktop', labels: [ENTER] });
  assert.ok(calls[1].url.endsWith('/menu/events?owner=' + OWNER + '&wait=1000'));
});

test('menu broker receives optional owned scope for the selected pet; no scope/env changes in legacy mode', async t => {
  const f = fixture(t);
  for (const scoped of [false, true]) {
    const env = { DSH_HOME: f.directory, ELECTRON_RUN_AS_NODE: '1', ...(scoped ? { TABLEBALL_PET_SCOPE_TAG: 'fixture_owned_scope_1234' } : {}) };
    let options, launched, closed = 0; const child = new EventEmitter(); child.pid = 12345; child.kill = () => child.emit('exit', 0);
    const controller = new MenuController({ base, electron: 'fake-electron', entry: 'fake-entry', env,
      brokerFactory: async value => { options = value; return { pipe: 'fake-broker', close: async () => { closed++; } }; },
      launch: (...args) => { launched = args; return child; }, sendCommand: async () => { queueMicrotask(() => child.emit('exit', 0)); }, log: () => {} });
    controller.bridge.request = async () => ({ ok: true });
    const pet = 'pet 甲'; await controller.start(pet);
    if (scoped) assert.deepEqual(options.scope, scopeFromEnv(env, pet)); else assert.equal(Object.hasOwn(options, 'scope'), false);
    assert.equal(options.expectedOwner(), child.pid);
    assert.equal(launched[2].env.TABLEBALL_PET_ID, pet);
    assert.equal(launched[2].env.TABLEBALL_VISIBILITY_BROKER, 'fake-broker');
    assert.equal(launched[2].env.TABLEBALL_PET_SCOPE_TAG, env.TABLEBALL_PET_SCOPE_TAG);
    assert.equal(Object.hasOwn(launched[2].env, 'ELECTRON_RUN_AS_NODE'), false);
    assert.equal(Object.hasOwn(launched[2].env, 'TABLEBALL_PET_RUNTIME_FILE'), false);
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
    await controller.dispose(); await controller.brokerClosing; assert.equal(closed, 1);
  }
});

test('invalid scope cannot reach broker or child launch', async () => {
  let calls = 0;
  const controller = new MenuController({ base, env: { TABLEBALL_PET_SCOPE_TAG: 'bad tag' }, brokerFactory: async () => { calls++; }, launch: () => { calls++; } });
  await assert.rejects(controller.start('main'), /scope tag/); assert.equal(calls, 0);
});
