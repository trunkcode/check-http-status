'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const base64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function configDir() {
  const base = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));

  return path.join(base, 'check-http-status');
}

function saveCredentials(file, data) {
  fs.mkdirSync(path.dirname(file), { 'recursive': true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { 'mode': 0o600 });
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function postToken(endpoint, params, service) {
  const response = await fetch(endpoint, {
    'body': new URLSearchParams(params),
    'headers': { 'Content-Type': 'application/x-www-form-urlencoded' },
    'method': 'POST'
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    const reason = data.error_description ? data.error_description.split(/\r?\n/)[0] : (data.error || response.status);
    throw new Error(`${service}: authentication failed (${reason}).`);
  }

  return data;
}

function openBrowser(url) {
  const { spawn } = require('child_process');
  const [command, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];

  try {
    spawn(command, args, { 'detached': true, 'stdio': 'ignore' }).on('error', () => {}).unref();
  } catch {
    // The URL is printed as well, so the user can open it manually.
  }
}

// Browser sign-in with a loopback redirect and PKCE (RFC 8252).
function loopbackLogin(options) {
  const verifier = base64url(crypto.randomBytes(32));
  const state = base64url(crypto.randomBytes(16));
  const log = options.log || console.error;
  const servers = [];
  let redirectUri = '';

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) {
        return;
      }

      settled = true;
      servers.forEach((server) => server.close());
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const handler = (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/') {
        res.writeHead(404);
        return res.end();
      }

      const error = url.searchParams.get('error');
      const ok = !error && url.searchParams.get('state') === state && url.searchParams.get('code');
      const description = String(url.searchParams.get('error_description') || error || 'Invalid response.').replace(/[<>&]/g, '');

      res.writeHead(ok ? 200 : 400, { 'Connection': 'close', 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ok
        ? `<h2>check-http-status is connected to ${options.service}.</h2><p>You can close this tab.</p>`
        : `<h2>${options.service} sign-in failed.</h2><p>${description}</p>`);

      if (ok) {
        finish(null, { 'code': url.searchParams.get('code'), redirectUri, verifier });
      } else {
        finish(new Error(`${options.service} login failed${error ? ': ' + description : '.'}`));
      }
    };

    // "localhost" may resolve to IPv4 or IPv6.
    const primary = http.createServer(handler);
    servers.push(primary);
    primary.on('error', (error) => finish(error));
    primary.listen(0, '127.0.0.1', () => {
      const port = primary.address().port;
      const secondary = http.createServer(handler);
      secondary.on('error', () => {});
      secondary.listen(port, '::1');
      servers.push(secondary);

      redirectUri = `http://${options.redirectHost || '127.0.0.1'}:${port}`;
      const authUrl = `${options.authEndpoint}?${new URLSearchParams({
        ...options.params,
        'code_challenge': base64url(crypto.createHash('sha256').update(verifier).digest()),
        'code_challenge_method': 'S256',
        'redirect_uri': redirectUri,
        'response_type': 'code',
        'state': state
      })}`;

      log(`Opening your browser to sign in to ${options.service}. If it does not open, visit:\n\n${authUrl}\n`);
      (options.openBrowser || openBrowser)(authUrl);
    });

    setTimeout(() => finish(new Error(`${options.service} login timed out after 5 minutes.`)), 5 * 60 * 1000).unref();
  });
}

module.exports = {
  base64url,
  configDir,
  loopbackLogin,
  parseJson,
  postToken,
  saveCredentials
};
