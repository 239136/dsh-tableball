'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PetBridge, restore } = require('../runtime/pet-bridge.cjs');
const { cueFromWindow } = require('../runtime/geometry.cjs');

// Never import Electron/main, launch helpers, or touch a real pet config/API.
function fixture(t, config = { physics: { gravity: 1400, custom: true }, theme: 'dark' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tableball-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.jsonc'), journal = path.join(dir, 'restore.json');
  fs.writeFileSync(file, JSON.stringify(config));
  return { file, journal, bridge: new PetBridge({ base: 'http://127.0.0.1:3080/pet-test', file, journal }) };
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const reply = value => ({ ok: true, status: 200, json: async () => value });
function api(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  });
  return calls;
}
const effective = { main: { physics: { gravity: 1400, restitution: .78, groundFriction: 2.5, extra: 'kept' } } };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('flat patch journals original values and recover reverses only the patch', async t => {
  const original = { physics: { gravity: 900, userOption: 7 }, confineToScreen: false, theme: 'dark' };
  const { bridge, file, journal } = fixture(t, original);
  const calls = api(t, url => reply(url.endsWith('/config') ? effective : { ok: true }));
  await bridge.flat();
  assert.deepEqual(read(file), { ...original, physics: { ...effective.main.physics, gravity: 0, restitution: .94, groundFriction: .4, tiltGravity: false }, confineToScreen: true });
  assert.deepEqual(read(journal).original, { physics: original.physics, confineToScreen: false });
  assert.equal(await bridge.recover(), true);
  assert.deepEqual(read(file), original);
  assert.equal(fs.existsSync(journal), false);
  assert.equal(await bridge.recover(), false);
  assert.deepEqual(calls.map(c => [c.url.split('/').pop(), c.options.method]), [['config', 'GET'], ['reload', 'POST'], ['reload', 'POST']]);
});

test('restore deletes originally absent patch keys and preserves unrelated user edits', async t => {
  const { bridge, file, journal } = fixture(t, { theme: 'dark', nested: { before: true } });
  api(t, url => reply(url.endsWith('/config') ? effective : { ok: true }));
  await bridge.flat();
  const edited = { ...read(file), theme: 'light', nested: { after: true }, newKey: 42 };
  fs.writeFileSync(file, JSON.stringify(edited));
  assert.equal(restore(journal), true);
  assert.deepEqual(read(file), { theme: 'light', nested: { after: true }, newKey: 42 });
  assert.equal(restore(journal), false);
});

test('conflicting physics or confinement edits reject restoration without partial writes', async t => {
  for (const key of ['physics', 'confineToScreen']) {
    const { bridge, file, journal } = fixture(t);
    api(t, url => reply(url.endsWith('/config') ? effective : { ok: true }));
    await bridge.flat();
    const edited = read(file);
    if (key === 'physics') edited.physics.gravity = 123;
    else edited.confineToScreen = false;
    fs.writeFileSync(file, JSON.stringify(edited));
    const before = fs.readFileSync(file, 'utf8'), recovery = fs.readFileSync(journal, 'utf8');
    await assert.rejects(bridge.recover(), /修改|conflict/i);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.readFileSync(journal, 'utf8'), recovery);
    t.mock.restoreAll();
  }
});

test('existing recovery journal prevents another flat patch before any API request', async t => {
  const { bridge, file, journal } = fixture(t);
  fs.writeFileSync(journal, 'existing recovery evidence');
  const before = fs.readFileSync(file, 'utf8');
  const calls = api(t, () => { throw Error('must not fetch'); });
  await assert.rejects(bridge.flat(), /恢复|journal/i);
  assert.equal(calls.length, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.readFileSync(journal, 'utf8'), 'existing recovery evidence');
});

test('commented JSONC fails closed without changing config or creating journal', async t => {
  const { bridge, file, journal } = fixture(t);
  const source = '{ // preserve user comments\n  "physics": {"gravity": 900}\n}';
  fs.writeFileSync(file, source);
  api(t, () => reply(effective));
  await assert.rejects(bridge.flat(), SyntaxError);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.equal(fs.existsSync(journal), false);
});

test('failed patch reload rolls back disk config and leaves no patch active', async t => {
  const original = { physics: { gravity: 600 }, color: 'blue' };
  const { bridge, file, journal } = fixture(t, original);
  api(t, url => { if (url.endsWith('/config')) return reply(effective); throw Error('fixture network failure'); });
  await assert.rejects(bridge.flat(), /fixture network failure/);
  assert.deepEqual(read(file), original);
  // Whether a pending-reload journal remains is an implementation detail.
  if (fs.existsSync(journal)) assert.equal(read(journal).file, file);
});

test('failed patch reload preserves unrelated edits made while the API call was in flight', async t => {
  const original = { physics: { gravity: 600 }, theme: 'before' };
  const { bridge, file } = fixture(t, original);
  api(t, url => {
    if (url.endsWith('/config')) return reply(effective);
    fs.writeFileSync(file, JSON.stringify({ ...read(file), theme: 'after', added: 7 }));
    throw Error('reload failed after unrelated edit');
  });
  await assert.rejects(bridge.flat(), /reload failed/);
  assert.deepEqual(read(file), { ...original, theme: 'after', added: 7 });
});

test('failed config API lookup leaves original bytes untouched and creates no recovery journal', async t => {
  const { bridge, file, journal } = fixture(t);
  const before = fs.readFileSync(file, 'utf8');
  api(t, () => ({ ok: false, status: 503 }));
  await assert.rejects(bridge.flat(), /503/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(journal), false);
});

test('recovery reload failure can be retried rather than silently losing recovery state', async t => {
  const original = { physics: { gravity: 900 } };
  const { bridge, file } = fixture(t, original);
  let failReload = false;
  const calls = api(t, url => {
    if (url.endsWith('/config')) return reply(effective);
    if (failReload) throw Error('reload temporarily unavailable');
    return reply({ ok: true });
  });
  await bridge.flat();
  failReload = true;
  await assert.rejects(bridge.recover(), /reload temporarily unavailable/);
  assert.deepEqual(read(file), original);
  failReload = false;
  const prior = calls.length;
  await bridge.recover();
  assert.equal(calls.length, prior + 1, 'retry must reactivate restored disk configuration through /reload');
  assert.deepEqual(read(file), original);
});

test('public loopback API accepts IPv4, localhost and IPv6 with JSON POST payload', async t => {
  const { bridge } = fixture(t);
  const calls = api(t, () => reply({ ok: true }));
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    bridge.base = `http://${host}:3080/pet-test`;
    assert.deepEqual(await bridge.request('/position', 'POST', { x: .25, y: .5 }), { ok: true });
    const call = calls.at(-1);
    assert.equal(call.url, bridge.base + '/position');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(call.options.body), { x: .25, y: .5 });
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('public loopback API rejects remote hosts, deceptive hosts and non-HTTP URLs before fetch', async t => {
  const { bridge } = fixture(t);
  const calls = api(t, () => { throw Error('unexpected fetch'); });
  for (const base of ['http://example.com/pet', 'http://192.168.1.2/pet', 'http://127.0.0.1.example.com/pet', 'http://localhost@example.com/pet', 'https://127.0.0.1/pet', 'file:///tmp/pet', 'not a URL']) {
    bridge.base = base;
    await assert.rejects(bridge.request('/config'));
  }
  assert.equal(calls.length, 0);
});

test('public loopback API refuses redirects instead of following an unvalidated destination', async t => {
  const { bridge } = fixture(t);
  const calls = api(t, () => ({ ok: false, status: 302, json: async () => ({}) }));
  await assert.rejects(bridge.request('/config'), /302|redirect/i);
  assert.ok(['error', 'manual'].includes(calls[0].options.redirect), 'fetch must not automatically follow redirects outside loopback');
});

test('public loopback API surfaces HTTP, logical, malformed JSON, network and timeout failures', async t => {
  const { bridge } = fixture(t);
  const failures = [
    [() => ({ ok: false, status: 503 }), /503/],
    [() => reply({ ok: false, message: 'denied' }), /denied/],
    [() => reply({ error: 'invalid operation' }), /invalid operation/],
    [() => ({ ok: true, json: async () => { throw SyntaxError('invalid JSON fixture'); } }), /invalid JSON fixture/],
    [() => { throw TypeError('connection refused fixture'); }, /connection refused fixture/],
    [() => { throw new DOMException('timeout fixture', 'TimeoutError'); }, /timeout fixture/]
  ];
  for (const [handler, pattern] of failures) {
    api(t, handler);
    await assert.rejects(bridge.request('/config'), pattern);
    t.mock.restoreAll();
  }
});

test('position maps negative-origin multi-display work areas and encodes the pet identifier', async t => {
  const { bridge } = fixture(t);
  const calls = api(t, () => reply({ ok: true }));
  await bridge.position({ x: 0, y: 500 }, [
    { workArea: { x: -1920, y: -100, width: 1920, height: 1080 } },
    { workArea: { x: 0, y: 0, width: 1920, height: 1000 } }
  ], 'pet /?&');
  assert.equal(calls[0].url, bridge.base + '/position?surface=desktop&pet=pet%20%2F%3F%26');
  const body = JSON.parse(calls[0].options.body);
  close(body.x, .5); close(body.y, 600 / 1100);
  assert.equal(body.mode, 'instant');
});

test('geometry maps sprite center and radius from physical pixels through DIP into work-area coordinates', () => {
  const seen = [];
  const dip = p => { seen.push(p); return { x: p.x / 2, y: p.y / 2 }; };
  const cue = cueFromWindow({ found: true, x: -400, y: 200, width: 1280, height: 1200, down: true },
    { x: -300, y: 40, width: 1920, height: 1032 }, dip, { offsetX: 12, offsetY: -8, cueScale: 1.5 });
  assert.deepEqual(seen, [{ x: -400, y: 200 }, { x: 880, y: 1400 }]);
  // DIP width=640, size=320, stageHeight=180, margin=160, stageTop+padding=360.
  close(cue.x, 432); close(cue.y, 408.25); close(cue.radius, 90);
  assert.equal(cue.down, true);
});

test('geometry defaults settings and returns null for absent or nonpositive window sizes', () => {
  const identity = p => p, work = { x: 0, y: 0 };
  for (const rect of [null, {}, { found: false }, { found: true, width: 0, height: 2 }, { found: true, width: 2, height: -1 }]) {
    assert.equal(cueFromWindow(rect, work, () => { throw Error('invalid rect must not be converted'); }), null);
  }
  const cue = cueFromWindow({ found: true, x: 0, y: 0, width: 1280, height: 1200 }, work, identity);
  close(cue.x, 640); close(cue.y, 712.5); close(cue.radius, 120);
  assert.equal(cue.down, false);
});

test('geometry rejects non-finite tracker samples and invalid converted dimensions', () => {
  const base = { found: true, x: 10, y: 20, width: 1280, height: 1200 };
  const work = { x: 0, y: 0 };
  for (const key of ['x', 'y', 'width', 'height']) {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(cueFromWindow({ ...base, [key]: value }, work, p => p), null, `${key}=${value}`);
    }
  }
  assert.equal(cueFromWindow(base, work, () => ({ x: 0, y: 0 })), null);
  assert.equal(cueFromWindow(base, work, p => ({ x: -p.x, y: p.y })), null);
});
