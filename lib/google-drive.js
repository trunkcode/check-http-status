'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { base64url, configDir, loopbackLogin, parseJson, postToken, saveCredentials } = require('./oauth');

const SERVICE = 'Google Drive';
// `drive.file` only sees files this tool created; existing folders need `drive`.
const SCOPE_APP_FILES = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_FULL = 'https://www.googleapis.com/auth/drive';
const DEFAULT_FOLDER = 'HTTP Status Reports';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const DEFAULT_ENDPOINTS = {
  'auth': 'https://accounts.google.com/o/oauth2/v2/auth',
  'files': 'https://www.googleapis.com/drive/v3/files',
  'token': 'https://oauth2.googleapis.com/token',
  'upload': 'https://www.googleapis.com/upload/drive/v3/files'
};
const MIME_TYPES = {
  'csv': 'text/csv',
  'html': 'text/html',
  'json': 'application/json',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function savedLoginPath() {
  return path.join(configDir(), 'google-credentials.json');
}

// Order: options, environment variables, saved login.
function resolveCredentials(options = {}) {
  const read = (file) => parseJson(fs.readFileSync(file, 'utf8'), `${SERVICE}: ${file}`);
  let credentials = null;

  if (options.credentials) {
    credentials = typeof options.credentials === 'string' ? parseJson(options.credentials, `${SERVICE}: credentials`) : options.credentials;
  } else if (options.keyFile) {
    credentials = read(options.keyFile);
  } else if (options.clientId && options.refreshToken) {
    credentials = {
      'client_id': options.clientId,
      'client_secret': options.clientSecret || '',
      'refresh_token': options.refreshToken,
      'type': 'authorized_user'
    };
  } else if (process.env.CHS_GOOGLE_CREDENTIALS) {
    credentials = parseJson(process.env.CHS_GOOGLE_CREDENTIALS, `${SERVICE}: CHS_GOOGLE_CREDENTIALS`);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credentials = read(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  } else if (fs.existsSync(savedLoginPath())) {
    credentials = read(savedLoginPath());
  }

  if (!credentials) {
    throw new Error(`${SERVICE}: no credentials found. Run "check-http-status drive-login", or set CHS_GOOGLE_CREDENTIALS / GOOGLE_APPLICATION_CREDENTIALS to a service account key.`);
  }

  if (credentials.type === 'service_account' && credentials.client_email && credentials.private_key) {
    return credentials;
  } else if (credentials.refresh_token && credentials.client_id) {
    return { ...credentials, 'type': 'authorized_user' };
  }

  throw new Error(`${SERVICE}: credentials must be a service account key or contain client_id, client_secret and refresh_token.`);
}

async function getAccessToken(credentials, endpoints, scope) {
  if (credentials.type === 'service_account') {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ 'alg': 'RS256', 'typ': 'JWT' }));
    const claims = base64url(JSON.stringify({
      'aud': endpoints.token,
      'exp': now + 3600,
      'iat': now,
      'iss': credentials.client_email,
      'scope': scope
    }));
    const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(credentials.private_key);
    const data = await postToken(endpoints.token, {
      'assertion': `${header}.${claims}.${base64url(signature)}`,
      'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer'
    }, SERVICE);

    return data.access_token;
  }

  const data = await postToken(endpoints.token, {
    'client_id': credentials.client_id,
    'client_secret': credentials.client_secret || '',
    'grant_type': 'refresh_token',
    'refresh_token': credentials.refresh_token
  }, SERVICE);

  return data.access_token;
}

async function driveError(response) {
  const data = await response.json().catch(() => null);
  const message = data && data.error && (data.error.message || data.error);
  let hint = '';

  if (/storage quota/i.test(String(message))) {
    hint = ' - service accounts have no storage of their own: upload into a Shared Drive folder, or use "check-http-status drive-login" instead';
  } else if (response.status === 404) {
    hint = ' - check the folder ID and that the folder is shared with this account. To upload into a folder you created yourself, sign in with "check-http-status drive-login --full-access"';
  }

  return `${response.status}${message ? ': ' + message : ''}${hint}`;
}

// With drive.file, the search only sees folders this tool created.
async function findOrCreateFolder(name, accessToken, endpoints) {
  const headers = { 'Authorization': `Bearer ${accessToken}` };
  const query = `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const search = await fetch(`${endpoints.files}?${new URLSearchParams({ 'fields': 'files(id)', 'pageSize': '1', 'q': query, 'spaces': 'drive' })}`, { headers });

  if (!search.ok) {
    throw new Error(`${SERVICE}: could not look up the "${name}" folder (${await driveError(search)}).`);
  }

  const found = (await search.json()).files || [];
  if (found.length) {
    return found[0].id;
  }

  const create = await fetch(`${endpoints.files}?fields=id`, {
    'body': JSON.stringify({ 'mimeType': FOLDER_MIME, name }),
    'headers': { ...headers, 'Content-Type': 'application/json' },
    'method': 'POST'
  });

  if (!create.ok) {
    throw new Error(`${SERVICE}: could not create the "${name}" folder (${await driveError(create)}).`);
  }

  return (await create.json()).id;
}

// Resumable upload: works for any file size.
async function uploadFile(file, format, accessToken, options, endpoints) {
  const convert = options.convert !== false && (format === 'xlsx' || format === 'csv');
  const name = convert ? path.basename(file, path.extname(file)) : path.basename(file);
  const metadata = { name };

  if (convert) {
    metadata.mimeType = GOOGLE_SHEET;
  }

  if (options.folderId) {
    metadata.parents = [options.folderId];
  }

  const query = 'uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,webViewLink';
  const start = await fetch(`${endpoints.upload}?${query}`, {
    'body': JSON.stringify(metadata),
    'headers': {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': MIME_TYPES[format]
    },
    'method': 'POST'
  });

  if (!start.ok || !start.headers.get('location')) {
    throw new Error(`${SERVICE}: could not start upload of ${path.basename(file)} (${await driveError(start)}).`);
  }

  const finish = await fetch(start.headers.get('location'), {
    'body': await fs.promises.readFile(file),
    'headers': { 'Content-Type': MIME_TYPES[format] },
    'method': 'PUT'
  });

  if (!finish.ok) {
    throw new Error(`${SERVICE}: upload of ${path.basename(file)} failed (${await driveError(finish)}).`);
  }

  const uploaded = await finish.json();
  const result = {
    'file': file,
    'id': uploaded.id,
    'mimeType': uploaded.mimeType,
    'name': uploaded.name,
    'public': false,
    'service': 'googleDrive',
    'url': uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`
  };

  if (options.public) {
    await makePublic(uploaded.id, accessToken, endpoints, uploaded.name);
    result.public = true;
  }

  return result;
}

async function makePublic(fileId, accessToken, endpoints, name) {
  const response = await fetch(`${endpoints.files}/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, {
    'body': JSON.stringify({ 'role': 'reader', 'type': 'anyone' }),
    'headers': {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    'method': 'POST'
  });

  if (!response.ok) {
    const reason = await driveError(response);
    const hint = response.status === 403 ? ' - your Google Workspace admin may block sharing files publicly' : '';
    throw new Error(`${SERVICE}: uploaded ${name} but could not make it public (${reason}${hint}).`);
  }
}

async function uploadToDrive(files, options = {}) {
  const endpoints = { ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) };
  const credentials = resolveCredentials(options);
  // A service account only sees folders shared with it, so full scope is safe there.
  const scope = credentials.type === 'service_account' && options.folderId ? SCOPE_FULL : SCOPE_APP_FILES;
  const accessToken = await getAccessToken(credentials, endpoints, scope);
  const folderId = options.folderId || await findOrCreateFolder(options.folderName || DEFAULT_FOLDER, accessToken, endpoints);
  const uploads = [];

  for (const { file, format } of files) {
    uploads.push(await uploadFile(file, format, accessToken, { ...options, folderId }, endpoints));
  }

  return uploads;
}

async function login(options) {
  const endpoints = { ...DEFAULT_ENDPOINTS, ...(options.endpoints || {}) };
  const { code, redirectUri, verifier } = await loopbackLogin({
    'authEndpoint': endpoints.auth,
    'log': options.log,
    'openBrowser': options.openBrowser,
    'params': {
      'access_type': 'offline',
      'client_id': options.clientId,
      'prompt': 'consent',
      'scope': options.fullAccess ? SCOPE_FULL : SCOPE_APP_FILES
    },
    'redirectHost': '127.0.0.1',
    'service': SERVICE
  });

  const tokens = await postToken(endpoints.token, {
    'client_id': options.clientId,
    'client_secret': options.clientSecret || '',
    'code': code,
    'code_verifier': verifier,
    'grant_type': 'authorization_code',
    'redirect_uri': redirectUri
  }, SERVICE);

  if (!tokens.refresh_token) {
    throw new Error(`${SERVICE}: Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and try again.`);
  }

  const file = options.saveTo || savedLoginPath();
  saveCredentials(file, {
    'client_id': options.clientId,
    'client_secret': options.clientSecret || '',
    'refresh_token': tokens.refresh_token,
    'type': 'authorized_user'
  });

  return file;
}

module.exports = {
  login,
  resolveCredentials,
  savedLoginPath,
  uploadToDrive
};
