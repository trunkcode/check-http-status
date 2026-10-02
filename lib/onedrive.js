'use strict';

const fs = require('fs');
const path = require('path');
const { configDir, loopbackLogin, parseJson, postToken, saveCredentials } = require('./oauth');

const SERVICE = 'OneDrive';
// AppFolder scope only sees "Apps/<app name>".
const SCOPE_APP_FOLDER = 'offline_access Files.ReadWrite.AppFolder';
const SCOPE_FULL = 'offline_access Files.ReadWrite';
const DEFAULT_ENDPOINTS = {
  'graph': 'https://graph.microsoft.com/v1.0',
  'login': 'https://login.microsoftonline.com'
};
// Upload session chunks must be a multiple of 320 KiB.
const CHUNK_SIZE = 320 * 1024 * 32;

function savedLoginPath() {
  return path.join(configDir(), 'onedrive-credentials.json');
}

// Order: options, CHS_ONEDRIVE_CREDENTIALS, saved login.
function resolveCredentials(options = {}) {
  let credentials = null;

  if (options.credentials) {
    credentials = typeof options.credentials === 'string' ? parseJson(options.credentials, `${SERVICE}: credentials`) : options.credentials;
  } else if (options.clientId && options.refreshToken) {
    credentials = {
      'client_id': options.clientId,
      'refresh_token': options.refreshToken,
      'tenant': options.tenant
    };
  } else if (process.env.CHS_ONEDRIVE_CREDENTIALS) {
    credentials = parseJson(process.env.CHS_ONEDRIVE_CREDENTIALS, `${SERVICE}: CHS_ONEDRIVE_CREDENTIALS`);
  } else if (fs.existsSync(savedLoginPath())) {
    credentials = { ...parseJson(fs.readFileSync(savedLoginPath(), 'utf8'), `${SERVICE}: ${savedLoginPath()}`), 'savedFile': savedLoginPath() };
  }

  if (!credentials) {
    throw new Error(`${SERVICE}: no credentials found. Run "check-http-status onedrive-login", or set CHS_ONEDRIVE_CREDENTIALS.`);
  }

  if (!credentials.client_id || !credentials.refresh_token) {
    throw new Error(`${SERVICE}: credentials must contain client_id and refresh_token.`);
  }

  return { ...credentials, 'tenant': credentials.tenant || 'common' };
}

async function getAccessToken(credentials, endpoints) {
  const params = {
    'client_id': credentials.client_id,
    'grant_type': 'refresh_token',
    'refresh_token': credentials.refresh_token,
    'scope': credentials.scope || SCOPE_APP_FOLDER
  };

  if (credentials.client_secret) {
    params.client_secret = credentials.client_secret;
  }

  const data = await postToken(`${endpoints.login}/${encodeURIComponent(credentials.tenant)}/oauth2/v2.0/token`, params, SERVICE);

  // Microsoft rotates refresh tokens; keep the saved login fresh.
  if (credentials.savedFile && data.refresh_token && data.refresh_token !== credentials.refresh_token) {
    const { savedFile, ...saved } = credentials;
    try {
      saveCredentials(savedFile, { ...saved, 'refresh_token': data.refresh_token });
    } catch {
      // Not fatal: the old refresh token stays valid until it expires.
    }
  }

  return data.access_token;
}

async function graphError(response) {
  const data = await response.json().catch(() => null);
  const message = data && data.error && (data.error.message || data.error.code || data.error);
  return `${response.status}${message ? ': ' + message : ''}`;
}

function itemPath(folderPath, name) {
  const encode = (segment) => encodeURIComponent(segment).replace(/'/g, '%27');
  if (!folderPath) {
    return `/me/drive/special/approot:/${encode(name)}:`;
  }

  const segments = folderPath.split(/[\\/]+/).filter(Boolean).map(encode);
  return `/me/drive/root:/${[...segments, encode(name)].join('/')}:`;
}

async function uploadFile(file, accessToken, options, endpoints) {
  const name = path.basename(file);
  const session = await fetch(`${endpoints.graph}${itemPath(options.folderPath, name)}/createUploadSession`, {
    'body': JSON.stringify({ 'item': { '@microsoft.graph.conflictBehavior': 'rename' } }),
    'headers': {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    'method': 'POST'
  });

  if (!session.ok) {
    const hint = session.status === 403 && options.folderPath ? ' - uploading into your own folders needs "check-http-status onedrive-login --full-access"' : '';
    throw new Error(`${SERVICE}: could not start upload of ${name} (${await graphError(session)}${hint}).`);
  }

  const { uploadUrl } = await session.json();
  const body = await fs.promises.readFile(file);
  let item = null;

  // The pre-authenticated upload URL must not receive the Authorization header.
  for (let offset = 0; offset < body.length; offset += CHUNK_SIZE) {
    const chunk = body.subarray(offset, offset + CHUNK_SIZE);
    const end = offset + chunk.length - 1;
    const response = await fetch(uploadUrl, {
      'body': chunk,
      // fetch sets Content-Length; setting it by hand breaks on Node 20/22.
      'headers': { 'Content-Range': `bytes ${offset}-${end}/${body.length}` },
      'method': 'PUT'
    });

    if (!response.ok) {
      throw new Error(`${SERVICE}: upload of ${name} failed (${await graphError(response)}).`);
    }

    if (response.status === 200 || response.status === 201) {
      item = await response.json();
      break;
    }

    await response.body.cancel().catch(() => {});
  }

  if (!item) {
    throw new Error(`${SERVICE}: upload of ${name} did not complete.`);
  }

  const result = {
    'file': file,
    'id': item.id,
    'name': item.name,
    'public': false,
    'service': 'oneDrive',
    'url': item.webUrl
  };

  if (options.public) {
    result.url = await createPublicLink(item.id, accessToken, endpoints, item.name);
    result.public = true;
  }

  return result;
}

async function createPublicLink(itemId, accessToken, endpoints, name) {
  const response = await fetch(`${endpoints.graph}/me/drive/items/${encodeURIComponent(itemId)}/createLink`, {
    'body': JSON.stringify({ 'scope': 'anonymous', 'type': 'view' }),
    'headers': {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    'method': 'POST'
  });

  if (!response.ok) {
    const hint = response.status === 403 || response.status === 400 ? ' - your organization may not allow "anyone with the link" sharing' : '';
    throw new Error(`${SERVICE}: uploaded ${name} but could not create a public link (${await graphError(response)}${hint}).`);
  }

  return (await response.json()).link.webUrl;
}

async function uploadToOneDrive(files, options = {}) {
  const endpoints = { ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) };
  const credentials = resolveCredentials(options);
  const accessToken = await getAccessToken(credentials, endpoints);
  const uploads = [];

  for (const { file } of files) {
    uploads.push(await uploadFile(file, accessToken, options, endpoints));
  }

  return uploads;
}

async function login(options) {
  const endpoints = { ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) };
  const tenant = options.tenant || 'common';
  const scope = options.fullAccess ? SCOPE_FULL : SCOPE_APP_FOLDER;
  const base = `${endpoints.login}/${encodeURIComponent(tenant)}/oauth2/v2.0`;

  const { code, redirectUri, verifier } = await loopbackLogin({
    'authEndpoint': `${base}/authorize`,
    'log': options.log,
    'openBrowser': options.openBrowser,
    'params': {
      'client_id': options.clientId,
      'prompt': 'select_account',
      'scope': scope
    },
    // Microsoft matches "http://localhost" redirect URIs on any port.
    'redirectHost': 'localhost',
    'service': SERVICE
  });

  const tokens = await postToken(`${base}/token`, {
    'client_id': options.clientId,
    'code': code,
    'code_verifier': verifier,
    'grant_type': 'authorization_code',
    'redirect_uri': redirectUri,
    'scope': scope
  }, SERVICE);

  if (!tokens.refresh_token) {
    throw new Error(`${SERVICE}: Microsoft did not return a refresh token (the offline_access permission is required).`);
  }

  const file = options.saveTo || savedLoginPath();
  saveCredentials(file, {
    'client_id': options.clientId,
    'refresh_token': tokens.refresh_token,
    'scope': scope,
    'tenant': tenant
  });

  return file;
}

module.exports = {
  login,
  resolveCredentials,
  savedLoginPath,
  uploadToOneDrive
};
