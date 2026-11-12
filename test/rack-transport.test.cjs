/*
 * MIT License
 *
 * Copyright (c) 2026 Nick7612
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Protocol adaptation tests for Rack upstream
 * 6383542887caa822296c883e72391adba86ca82c; see the Node adaptation notes in
 * runtime/rack-transport.cjs. All networking is loopback; no desktop, discovery,
 * firewall, public-network or cloud interaction occurs.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const transport = require('../runtime/rack-transport.cjs');
const { RackServer, RackClient, VERSION, MAX_LINE, isPrivateIPv4, localAddresses } = transport;
const CODE = 'ABC123';
const hello = extra => ({ t: 'hello', v: 2, app: 'tableball', name: '玩家', code: CODE, ...extra });
const welcome = extra => ({ t: 'welcome', v: 2, app: 'tableball', player: 1, rules: 1, host: '房主', ...extra });
const line = packet => Buffer.from(JSON.stringify(packet) + '\n');
const turn = () => new Promise(resolve => setImmediate(resolve));

function event(emitter, name, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const done = (...args) => { clearTimeout(timer); resolve(args); };
    const timer = setTimeout(() => {
      emitter.removeListener(name, done);
      reject(new Error('Timed out waiting for ' + name));
    }, timeout);
    emitter.once(name, done);
  });
}

async function host(t, options = {}) {
  const server = new RackServer({ code: CODE, bind: '127.0.0.1', port: 0, ...options });
  t.after(() => server.close());
  await server.listen();
  return server;
}

async function guest(t, server, options = {}) {
  const client = new RackClient({ address: '127.0.0.1', port: server.port, code: CODE, ...options });
  t.after(() => client.close());
  await client.connect();
  return client;
}

// A real TCP peer with a queued NDJSON reader, also used to inspect exact wire
// shapes independently of RackClient/RackServer (no in-memory transport mock).
function wire(socket) {
  const queue = [];
  const waiters = [];
  let buffer = Buffer.alloc(0);
  const errors = [];
  const closed = new Promise(resolve => socket.once('close', resolve));
  socket.on('error', error => errors.push(error));
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    let newline;
    while ((newline = buffer.indexOf(10)) >= 0) {
      const text = buffer.subarray(0, newline).toString('utf8');
      buffer = buffer.subarray(newline + 1);
      if (!text.trim()) continue;
      const packet = JSON.parse(text);
      if (waiters.length) waiters.shift()(packet);
      else queue.push(packet);
    }
  });
  return {
    socket, closed, errors,
    send(packet) { socket.write(line(packet)); },
    next(timeout = 2000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const done = packet => { clearTimeout(timer); resolve(packet); };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(done);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('Timed out waiting for a wire frame'));
        }, timeout);
        waiters.push(done);
      });
    }
  };
}

async function rawGuest(t, port, options) {
  const socket = new net.Socket(options);
  const raw = wire(socket);
  t.after(async () => { socket.destroy(); await raw.closed; });
  const connected = event(socket, 'connect');
  socket.connect({ host: '127.0.0.1', port, family: 4 });
  await connected;
  return raw;
}

async function rawHost(t) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    pending(wire(socket));
  });
  let pending;
  const accepted = new Promise(resolve => { pending = resolve; });
  const listening = event(server, 'listening');
  server.listen({ host: '127.0.0.1', port: 0 });
  await listening;
  t.after(() => new Promise(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(resolve);
  }));
  return { port: server.address().port, accepted };
}

async function rawHandshake(raw) {
  raw.send(hello());
  assert.deepEqual(await raw.next(), welcome());
}

test('exports, constants, strict private IPv4 and interface enumeration', t => {
  assert.deepEqual(Object.keys(transport).sort(),
    ['MAX_LINE', 'RackClient', 'RackServer', 'VERSION', 'isPrivateIPv4', 'localAddresses']);
  assert.equal(VERSION, 2);
  assert.equal(MAX_LINE, 16384);
  for (const address of ['127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1',
    '172.31.255.254', '192.168.1.20']) assert.equal(isPrivateIPv4(address), true, address);
  for (const address of [undefined, null, 127, '', 'localhost', '8.8.8.8', '1.1.1.1',
    '0.0.0.0', '169.254.1.2', '172.15.1.1', '172.32.0.1', '192.169.0.1', '224.0.0.1',
    '255.255.255.255', '::1', '::ffff:127.0.0.1', '127.1', '0177.0.0.1',
    '127.0.0.1:46321', ' 127.0.0.1', '127.0.0.999']) {
    assert.equal(isPrivateIPv4(address), false, String(address));
  }
  t.mock.method(os, 'networkInterfaces', () => ({
    wifi: [{ family: 'IPv4', address: '192.168.1.10' }, { family: 'IPv6', address: '::1' }],
    loop: [{ family: 4, address: '127.0.0.1' }],
    duplicate: [{ family: 'IPv4', address: '192.168.1.10' }],
    public: [{ family: 'IPv4', address: '8.8.8.8' }]
  }));
  assert.deepEqual(localAddresses(), [
    { name: 'wifi', address: '192.168.1.10' }, { name: 'loop', address: '127.0.0.1' }
  ]);
  os.networkInterfaces.mock.mockImplementation(() => ({}));
  assert.deepEqual(localAddresses(), [{ name: 'loopback', address: '127.0.0.1' }]);
});

test('required six-character codes, rules, ports and bind validation', async () => {
  for (const code of [undefined, '', 'ABC12', 'ABC1234', 'AB C12', '房主ABCD', 'ABC12!']) {
    assert.throws(() => new RackServer({ code }), /six-character/);
    assert.throws(() => new RackClient({ address: '127.0.0.1', code }), /six-character/);
  }
  assert.throws(() => new RackServer({ code: CODE, rules: 2 }), /Rules/);
  for (const bind of ['localhost', '8.8.8.8', '::1']) {
    assert.throws(() => new RackServer({ code: CODE, bind }), /Bind/);
  }
  for (const port of [-1, 65536, 3.5, '46321']) {
    assert.throws(() => new RackServer({ code: CODE, port }), /port/);
    assert.throws(() => new RackClient({ code: CODE, port }), /port/);
  }
  assert.throws(() => new RackClient({ code: CODE, port: 0 }), /port/);
  const server = new RackServer({ code: 'abc123' });
  assert.equal(server.bind, '0.0.0.0');
  assert.equal(server.port, 46321);
  assert.equal(server.name, '房主');
  assert.equal(server.rules, 1);
  assert.equal(server.code, CODE);
  await server.close();
});

test('real loopback handshake returns the exact TableBall fork welcome', async t => {
  const server = await host(t, { name: '  房\n主\u0000\u202e' + '桌'.repeat(30), rules: 0 });
  const description = await server.listen();
  assert.equal(description.port, server.port);
  assert.equal(description.code, CODE);
  assert.deepEqual(description.addresses.map(entry => entry.address), ['127.0.0.1']);
  assert.equal(typeof description.addresses[0].name, 'string');
  const joined = event(server, 'join');
  const client = new RackClient({ address: '127.0.0.1', port: server.port,
    name: '\u0000\n 玩家\u202e' + '名'.repeat(30), code: 'abc123' });
  t.after(() => client.close());
  assert.equal(client.connected, false);
  assert.equal(client.send({ t: 'ready', ready: true }), false);
  const result = await client.connect();
  assert.deepEqual(result, welcome({ rules: 0, host: '房主' + '桌'.repeat(22) }));
  assert.deepEqual(await joined, [{ name: '玩家' + '名'.repeat(22) }]);
  assert.equal(client.connected, true);
  assert.deepEqual(await client.connect(), result);
  assert.equal('attest' in result, false);
  assert.equal('hostAttest' in result, false);
});

test('original-shaped state/snapshot and aim/shoot/place/ready/rematch pass unchanged', async t => {
  const server = await host(t);
  const client = await guest(t, server);
  const snapshot = { rules: 1, phase: 0, current: 0, winner: -1, names: ['房主', '玩家'],
    balls: [{ i: 0, x: 0.635, y: 0.635, a: true }, { i: 9, x: 1.905, y: 0.635, a: true }],
    cue: [0.635, 0.635] };
  for (const packet of [{ t: 'state', snapshot }, { t: 'start', snapshot },
    { t: 'aim', from: 0, angle: 0.42 }, { t: 'shot', by: 1, angle: 0.42, power: 0.75 }]) {
    const received = event(client, 'message');
    assert.equal(server.send(packet), true);
    assert.deepEqual(await received, [packet]);
  }
  for (const packet of [{ t: 'aim', angle: 0.42 }, { t: 'shoot', angle: 0.42, power: 0.75 },
    { t: 'place', x: 1.5, y: 0.8 }, { t: 'ready', ready: true }, { t: 'rematch' }]) {
    const received = event(server, 'message');
    assert.equal(client.send(packet), true);
    assert.deepEqual(await received, [packet]);
  }
});

test('wire hello/welcome omit all platform attestation and all envelopes', async t => {
  const server = await host(t);
  const raw = await rawGuest(t, server.port);
  raw.send(hello());
  assert.deepEqual(await raw.next(), welcome());
  const packet = { t: 'state', snapshot: { phase: 1, balls: [] } };
  assert.equal(server.send(packet), true);
  assert.deepEqual(await raw.next(), packet);

  const fake = await rawHost(t);
  const client = new RackClient({ address: '127.0.0.1', port: fake.port, code: CODE });
  t.after(() => client.close());
  const connecting = client.connect();
  const fakePeer = await fake.accepted;
  assert.deepEqual(await fakePeer.next(), hello());
  fakePeer.send(welcome());
  assert.deepEqual(await connecting, welcome());
});

test('wrong code/version/app and pre-auth application packets are rejected', async t => {
  for (const [label, packet, reason] of [
    ['code', hello({ code: 'BAD123' }), /code/i],
    ['missing code', hello({ code: undefined }), /code/i],
    ['version', hello({ v: 1 }), /protocol/i],
    ['string version', hello({ v: '2' }), /protocol/i],
    ['application', hello({ app: 'rack' }), /application/i],
    ['missing application', hello({ app: undefined }), /application/i],
    ['platform attestation is not a code', hello({ code: undefined, attest: { id: 'omarchy', ok: true } }), /code/i],
    ['first packet', { t: 'ready', ready: true }, /protocol/i],
    ['empty name', hello({ name: '\n\u0000\u202e' }), /name/i]
  ]) await t.test(label, async t => {
    const server = await host(t);
    let joined = 0;
    server.on('join', () => joined++);
    const raw = await rawGuest(t, server.port);
    raw.send(packet);
    const rejected = await raw.next();
    assert.equal(rejected.t, 'reject');
    assert.match(rejected.reason, reason);
    await raw.closed;
    assert.equal(joined, 0);
    assert.equal(server.send({ t: 'state', snapshot: {} }), false);
  });
});

test('client rejects bad fork welcomes, with safe unobserved errors', async t => {
  for (const [label, packet] of [
    ['version', welcome({ v: 1 })], ['app', welcome({ app: 'rack' })],
    ['missing app', welcome({ app: undefined })], ['wrong player', welcome({ player: 0 })],
    ['bad rules', welcome({ rules: 2 })], ['blank host', welcome({ host: '\n' })],
    ['state before welcome', { t: 'state', snapshot: {} }]
  ]) await t.test(label, async t => {
    const fake = await rawHost(t);
    const client = new RackClient({ address: '127.0.0.1', port: fake.port, code: CODE });
    t.after(() => client.close());
    const connecting = client.connect();
    const rejected = assert.rejects(connecting, /welcome handshake/);
    const raw = await fake.accepted;
    await raw.next();
    raw.send(packet);
    await rejected;
    await raw.closed;
    assert.equal(client.connected, false);
  });
});

test('public addresses, hostnames and IPv6 are refused before any socket is created', async () => {
  for (const address of ['8.8.8.8', 'example.com', 'localhost', '::1', '::ffff:127.0.0.1', '127.1', '0.0.0.0']) {
    const client = new RackClient({ address, code: CODE });
    await assert.rejects(client.connect(), { code: 'ERR_RACK_ADDRESS' });
    assert.equal(client._peer, null);
    assert.equal(client.connected, false);
    await client.close();
  }
});

test('exactly one authenticated guest; second guest cannot disturb the first', async t => {
  const server = await host(t);
  let joins = 0;
  let leaves = 0;
  server.on('join', () => joins++);
  server.on('leave', () => leaves++);
  const first = await guest(t, server);
  const second = new RackClient({ address: '127.0.0.1', port: server.port, code: CODE });
  t.after(() => second.close());
  await assert.rejects(second.connect(), /full/i);
  assert.equal(second.connected, false);
  assert.equal(first.connected, true);
  const received = event(server, 'message');
  first.send({ t: 'aim', angle: 1 });
  assert.deepEqual(await received, [{ t: 'aim', angle: 1 }]);
  assert.equal(joins, 1);
  assert.equal(leaves, 0);
});

test('a pending connection cannot race the occupied authenticated slot', async t => {
  const server = await host(t);
  const pending = await rawGuest(t, server.port);
  const first = await guest(t, server);
  pending.send(hello({ name: 'late' }));
  assert.match((await pending.next()).reason, /full/i);
  await pending.closed;
  assert.equal(first.connected, true);
});

test('split UTF-8 hello and coalesced frames are reassembled in order across parse slices', async t => {
  const server = await host(t);
  const raw = await rawGuest(t, server.port);
  const bytes = line(hello());
  const split = bytes.indexOf(Buffer.from('玩家')) + 1;
  raw.socket.write(bytes.subarray(0, split));
  await turn();
  raw.socket.write(bytes.subarray(split, bytes.length - 1));
  await turn();
  raw.socket.write(bytes.subarray(bytes.length - 1));
  assert.deepEqual(await raw.next(), welcome());
  const packets = Array.from({ length: 200 }, (_, index) => ({ t: 'aim', angle: index / 100 }));
  const received = [];
  const complete = new Promise(resolve => server.on('message', packet => {
    received.push(packet);
    if (received.length === packets.length) resolve();
  }));
  raw.socket.write(Buffer.concat([Buffer.from('\n \r\n'), ...packets.map(line)]));
  await complete;
  assert.deepEqual(received, packets);
});

test('malformed, non-object, invalid type and invalid UTF-8 frames close safely', async t => {
  for (const [label, bytes] of [
    ['JSON', Buffer.from('{bad}\n')], ['array', Buffer.from('[]\n')],
    ['null', Buffer.from('null\n')], ['number', Buffer.from('42\n')],
    ['missing t', Buffer.from('{}\n')], ['empty t', Buffer.from('{"t":""}\n')],
    ['numeric t', Buffer.from('{"t":1}\n')],
    ['invalid UTF-8', Buffer.concat([Buffer.from('{"t":"'), Buffer.from([255]), Buffer.from('"}\n')])]
  ]) await t.test(label, async t => {
    const server = await host(t);
    const raw = await rawGuest(t, server.port);
    raw.socket.write(bytes);
    assert.match((await raw.next()).reason, /malformed/i);
    await raw.closed;
  });
});

test('oversized terminated/unterminated frames and large input are disconnected', async t => {
  for (const [label, bytes] of [
    ['terminated', Buffer.from(JSON.stringify({ t: 'aim', junk: 'x'.repeat(MAX_LINE) }) + '\n')],
    ['unterminated', Buffer.alloc(MAX_LINE + 1, 120)],
    ['input flood', Buffer.alloc(MAX_LINE * 5, 120)]
  ]) await t.test(label, async t => {
    const server = await host(t);
    const raw = await rawGuest(t, server.port);
    raw.socket.write(bytes);
    assert.match((await raw.next()).reason, /16 KiB|64 KiB/);
    await raw.closed;
  });
});

test('client also rejects malformed and oversized input after authentication', async t => {
  for (const [label, bytes] of [
    ['malformed', Buffer.from('[]\n')], ['oversized', Buffer.alloc(MAX_LINE + 1, 120)]
  ]) await t.test(label, async t => {
    const fake = await rawHost(t);
    const client = new RackClient({ address: '127.0.0.1', port: fake.port, code: CODE });
    t.after(() => client.close());
    const connecting = client.connect();
    const raw = await fake.accepted;
    await raw.next();
    raw.send(welcome());
    await connecting;
    const left = event(client, 'leave');
    raw.socket.write(bytes);
    assert.match((await left)[0], /Malformed|16 KiB/);
    assert.equal(client.connected, false);
  });
});

test('16 KiB byte boundary is accepted; invalid outgoing packets return false safely', async t => {
  const server = await host(t);
  const client = await guest(t, server);
  const overhead = Buffer.byteLength(JSON.stringify({ t: 'chat', text: '' }));
  const exact = { t: 'chat', text: 'x'.repeat(MAX_LINE - overhead) };
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), MAX_LINE);
  const received = event(server, 'message');
  assert.equal(client.send(exact), true);
  assert.deepEqual(await received, [exact]);
  const circular = { t: 'aim' };
  circular.self = circular;
  for (const packet of [null, [], {}, { t: '' }, circular, { t: 'chat', text: '球'.repeat(MAX_LINE / 2) },
    { t: 'aim', toJSON() { return 'not an object'; } }]) {
    assert.equal(client.send(packet), false);
    assert.equal(server.send(packet), false);
  }
  assert.equal(client.connected, true);
});

test('ping/pong IDs are echoed in both directions and are never application messages', async t => {
  const server = await host(t);
  const raw = await rawGuest(t, server.port);
  await rawHandshake(raw);
  let messages = 0;
  server.on('message', () => messages++);
  raw.send({ t: 'ping', id: 7 });
  assert.deepEqual(await raw.next(), { t: 'pong', id: 7 });
  server._guest._tickHeartbeat();
  const ping = await raw.next();
  assert.equal(ping.t, 'ping');
  raw.send({ t: 'pong', id: ping.id + 1 });
  raw.send({ t: 'ready', ready: true });
  await event(server, 'message');
  assert.notEqual(server._guest._ping, null);
  const marker = event(server, 'message');
  raw.send({ t: 'pong', id: ping.id });
  raw.send({ t: 'ready', ready: false });
  await marker;
  assert.equal(server._guest._ping, null);
  assert.equal(messages, 2);

  const fake = await rawHost(t);
  const client = new RackClient({ address: '127.0.0.1', port: fake.port, code: CODE });
  t.after(() => client.close());
  const connecting = client.connect();
  const peer = await fake.accepted;
  await peer.next();
  peer.send(welcome());
  await connecting;
  peer.send({ t: 'ping', id: 'upstream-id' });
  assert.deepEqual(await peer.next(), { t: 'pong', id: 'upstream-id' });
  client._peer._tickHeartbeat();
  const clientPing = await peer.next();
  assert.equal(clientPing.t, 'ping');
  const state = event(client, 'message');
  peer.send({ t: 'pong', id: clientPing.id });
  peer.send({ t: 'state', snapshot: {} });
  assert.deepEqual(await state, [{ t: 'state', snapshot: {} }]);
  assert.equal(client._peer._ping, null);
});

test('unanswered heartbeat expires, without waiting fifteen real seconds', async t => {
  const server = await host(t);
  const raw = await rawGuest(t, server.port);
  await rawHandshake(raw);
  const left = event(server, 'leave');
  server._guest._tickHeartbeat();
  assert.equal((await raw.next()).t, 'ping');
  // Advance only this peer's recorded timestamp; sockets still use real TCP.
  server._guest._ping.sent = Date.now() - 15000;
  server._guest._tickHeartbeat();
  assert.match((await raw.next()).reason, /Heartbeat timed out/);
  await left;
});

test('backlog drops state only; reliable overflow disconnects without unbounded queuing', async t => {
  const server = await host(t);
  const client = await guest(t, server);
  // Deterministically expose the real socket's queue accounting. OS send-buffer
  // sizes vary, so a read-only length override avoids an unreliable flood test.
  const socket = server._guest.socket;
  Object.defineProperty(socket, 'writableLength', { configurable: true, value: MAX_LINE });
  assert.equal(server.send({ t: 'state', snapshot: {} }), false);
  const received = event(client, 'message');
  assert.equal(server.send({ t: 'ready', ready: true }), true);
  assert.deepEqual(await received, [{ t: 'ready', ready: true }]);
  Object.defineProperty(socket, 'writableLength', { configurable: true, value: MAX_LINE * 4 });
  const error = event(server, 'error');
  const left = event(server, 'leave');
  assert.equal(server.send({ t: 'shoot', angle: 1, power: 0.5 }), false);
  assert.equal((await error)[0].code, 'ERR_RACK_BACKLOG');
  delete socket.writableLength;
  await left;
  assert.equal(server.send({ t: 'ready' }), false);
});

test('eight pending sockets maximum and actual five-second authentication deadline', { timeout: 9000 }, async t => {
  const server = await host(t);
  const pending = [];
  for (let index = 0; index < 8; index++) pending.push(await rawGuest(t, server.port));
  assert.equal(server._pending.size, 8);
  const hostPeers = [...server._pending];
  const silentHost = await rawHost(t);
  const waitingClient = new RackClient({ address: '127.0.0.1', port: silentHost.port, code: CODE });
  t.after(() => waitingClient.close());
  const clientTimeout = assert.rejects(waitingClient.connect(), { code: 'ERR_RACK_AUTH_TIMEOUT' });
  const ninth = await rawGuest(t, server.port);
  assert.match((await ninth.next()).reason, /pending/i);
  await ninth.closed;
  const started = Date.now();
  const rejected = await Promise.all(pending.map(peer => peer.next(6500)));
  assert.ok(Date.now() - started >= 4500, 'authentication must not expire immediately');
  assert.ok(rejected.every(packet => packet.t === 'reject' && /Authentication timed out/.test(packet.reason)));
  await Promise.all([...pending, ...hostPeers].map(peer => peer.closed));
  await clientTimeout;
  assert.equal(waitingClient.connected, false);
  assert.equal(server._pending.size, 0);
  const client = await guest(t, server);
  assert.equal(client.connected, true);
});

test('unexpected disconnect releases the slot and local close is idempotent', async t => {
  const server = await host(t);
  const client = await guest(t, server);
  let leaves = 0;
  server.on('leave', () => leaves++);
  const left = event(server, 'leave');
  client._peer.socket.destroy();
  assert.equal(typeof (await left)[0], 'string');
  assert.equal(client.connected, false);
  await assert.rejects(client.connect(), /closed/i);
  const replacement = await guest(t, server);
  const remoteLeft = event(server, 'leave');
  const clientLeft = event(replacement, 'leave');
  const closing = replacement.close();
  assert.equal(replacement.close(), closing);
  assert.equal(replacement.connected, false);
  await closing;
  assert.equal(typeof (await remoteLeft)[0], 'string');
  assert.equal(typeof (await clientLeft)[0], 'string');
  assert.equal(leaves, 2);
  assert.equal(replacement.send({ t: 'ready' }), false);
  await assert.rejects(replacement.connect(), /closed/i);
});

test('host close notifies guest once and clears authenticated/pending sockets', async t => {
  const server = await host(t);
  const pending = await rawGuest(t, server.port);
  const client = await guest(t, server);
  const left = event(client, 'leave');
  const closing = server.close();
  assert.equal(server.close(), closing);
  assert.equal(server.send({ t: 'state', snapshot: {} }), false);
  await closing;
  assert.match((await left)[0], /Host closed/);
  await pending.closed;
  assert.equal(client.connected, false);
  assert.equal(server._peers.size, 0);
  await assert.rejects(server.listen(), /closed/i);
});



test('coalesced handshake plus application data works in both directions', async t => {
  const server = await host(t);
  const raw = await rawGuest(t, server.port);
  const aim = { t: 'aim', angle: 0.4 };
  const received = event(server, 'message');
  raw.socket.write(Buffer.concat([line(hello()), line(aim)]));
  assert.deepEqual(await raw.next(), welcome());
  assert.deepEqual(await received, [aim]);

  const fake = await rawHost(t);
  const client = new RackClient({ address: '127.0.0.1', port: fake.port, code: CODE });
  t.after(() => client.close());
  const state = { t: 'state', snapshot: { phase: 0, balls: [] } };
  const message = event(client, 'message');
  const connecting = client.connect();
  const peer = await fake.accepted;
  await peer.next();
  peer.socket.write(Buffer.concat([line(welcome()), line(state)]));
  assert.deepEqual(await connecting, welcome());
  assert.deepEqual(await message, [state]);
});

test('authenticated duplicate handshakes close rather than replacing identity', async t => {
  const server = await host(t);
  const raw = await rawGuest(t, server.port);
  await rawHandshake(raw);
  const left = event(server, 'leave');
  raw.send(hello({ name: 'replacement' }));
  assert.match((await raw.next()).reason, /duplicate handshake/i);
  await left;

  const fake = await rawHost(t);
  const client = new RackClient({ address: '127.0.0.1', port: fake.port, code: CODE });
  t.after(() => client.close());
  const connecting = client.connect();
  const peer = await fake.accepted;
  await peer.next();
  peer.send(welcome());
  await connecting;
  const clientLeft = event(client, 'leave');
  peer.send(welcome({ host: 'replacement' }));
  assert.match((await clientLeft)[0], /duplicate handshake/i);
});

test('host close is bounded even when the remote keeps its TCP half open', async t => {
  const server = await host(t);
  const raw = await rawGuest(t, server.port, { allowHalfOpen: true });
  await rawHandshake(raw);
  const started = Date.now();
  await server.close();
  assert.ok(Date.now() - started < 1500, 'close must not wait for an uncooperative remote');
  assert.equal(server._peers.size, 0);
  raw.socket.destroy();
  await raw.closed;
});

test('bind/refused-connection errors and close during startup are handled without listeners', async t => {
  const server = await host(t);
  const collision = new RackServer({ code: CODE, bind: '127.0.0.1', port: server.port });
  t.after(() => collision.close());
  await assert.rejects(collision.listen(), { code: 'EADDRINUSE' });
  const unusedPort = server.port;
  await server.close();
  const client = new RackClient({ address: '127.0.0.1', port: unusedPort, code: CODE });
  t.after(() => client.close());
  await assert.rejects(client.connect(), { code: 'ECONNREFUSED' });
  await client.close();

  const starting = new RackServer({ code: CODE, bind: '127.0.0.1', port: 0 });
  const listening = assert.rejects(starting.listen(), /closed/i);
  await starting.close();
  await listening;
  const neverConnected = new RackClient({ address: '127.0.0.1', code: CODE });
  await neverConnected.close();
  await assert.rejects(neverConnected.connect(), /closed/i);
});
