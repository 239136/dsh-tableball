'use strict';
const fs = require('node:fs');

const FAILURE = 'Protected pet API request failed';
const TOKEN_HEADER = 'x-dsh-pet-token';

function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error(FAILURE);
  }
  return url;
}

// Read only the explicitly selected private standalone state. Never infer a user
// profile, expose its contents, or cache credentials on a bridge/public payload.
function readToken(runtimeFile, trusted) {
  if (typeof runtimeFile !== 'string' || !runtimeFile.trim()) throw new Error(FAILURE);
  const source = fs.readFileSync(runtimeFile, 'utf8');
  if (Buffer.byteLength(source) > 64 * 1024) throw new Error(FAILURE);
  const state = JSON.parse(source);
  if (!state || !Number.isSafeInteger(state.pid) || state.pid <= 0 ||
      !Number.isInteger(state.port) || state.port < 1 || state.port > 65535 ||
      typeof state.token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(state.token) ||
      typeof state.settingsUrl !== 'string' || typeof state.pluginRoot !== 'string' || !state.pluginRoot.trim()) {
    throw new Error(FAILURE);
  }
  const settings = localUrl(state.settingsUrl);
  if (settings.origin !== trusted.origin || Number(trusted.port || 80) !== state.port || Number(settings.port || 80) !== state.port) throw new Error(FAILURE);
  return state.token;
}

function tokenHeaders(source, token) {
  if (source instanceof Headers) {
    const headers = new Headers(source);
    headers.set(TOKEN_HEADER, token);
    return headers;
  }
  if (Array.isArray(source)) {
    const headers = source.filter(([name]) => String(name).toLowerCase() !== TOKEN_HEADER).map(entry => [...entry]);
    headers.push([TOKEN_HEADER, token]);
    return headers;
  }
  const headers = { ...source };
  for (const name of Object.keys(headers)) if (name.toLowerCase() === TOKEN_HEADER) delete headers[name];
  headers[TOKEN_HEADER] = token;
  return headers;
}

/**
 * Fetch adapter for a trusted pet API base. Without runtimeFile (or the env
 * opt-in) the input, init, response and errors pass through unchanged. Protected
 * calls reread the manifest every time, so rotation needs no replay of writes.
 * Credentials remain in this closure and the request header only.
 */
function createPetFetch(base, { env = process.env, runtimeFile = env.TABLEBALL_PET_RUNTIME_FILE, fetchImpl } = {}) {
  const fetcher = (input, init) => (fetchImpl === undefined ? globalThis.fetch : fetchImpl)(input, init);
  if (runtimeFile === undefined) return fetcher;
  return async (input, init = {}) => {
    try {
      const trusted = localUrl(base);
      if (trusted.search || trusted.hash) throw new Error(FAILURE);
      const target = localUrl(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (target.origin !== trusted.origin || target.hash) throw new Error(FAILURE);
      const token = readToken(runtimeFile, trusted);
      const headers = tokenHeaders(init.headers === undefined ? input.headers : init.headers, token);
      const response = await fetcher(input, { ...init, headers, redirect: 'error' });
      // Native fetch refuses redirects above. Also fail closed for injected
      // fetchers that return a redirect/followed response instead of throwing.
      if (response.redirected || (response.status >= 300 && response.status < 400) ||
          (response.url && localUrl(response.url).origin !== trusted.origin)) throw new Error(FAILURE);
      return response;
    } catch {
      // No cause: filesystem/JSON/fetch errors can contain private state or URLs.
      throw new Error(FAILURE);
    }
  };
}

module.exports = { createPetFetch };
