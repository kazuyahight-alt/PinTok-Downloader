'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_URL_LENGTH = 2048;

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com'
]);

const PINTEREST_HOSTS = new Set([
  'pinterest.com',
  'www.pinterest.com',
  'id.pinterest.com',
  'pin.it',
  'www.pin.it'
]);

const PINTEREST_CDN_HOSTS = new Set([
  'i.pinimg.com',
  's.pinimg.com',
  'v.pinimg.com'
]);

function validateInputUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    const error = new Error('URL must be a string.');
    error.statusCode = 400;
    throw error;
  }

  const cleaned = rawUrl.trim();

  if (!cleaned) {
    const error = new Error('Please paste a TikTok or Pinterest URL first.');
    error.statusCode = 400;
    throw error;
  }

  if (cleaned.length > MAX_URL_LENGTH) {
    const error = new Error('URL is too long.');
    error.statusCode = 400;
    throw error;
  }

  let parsed;

  try {
    parsed = new URL(cleaned);
  } catch {
    const error = new Error('Invalid URL format.');
    error.statusCode = 400;
    throw error;
  }

  if (parsed.protocol !== 'https:') {
    const error = new Error('Only HTTPS URLs are allowed.');
    error.statusCode = 400;
    throw error;
  }

  if (parsed.username || parsed.password) {
    const error = new Error('URLs with username or password are not allowed.');
    error.statusCode = 400;
    throw error;
  }

  const hostname = normalizeHostname(parsed.hostname);

  if (isLocalOrIpHost(hostname)) {
    const error = new Error('Local, private, or IP-based URLs are not allowed.');
    error.statusCode = 400;
    throw error;
  }

  const platform = detectPlatform(hostname);

  if (!platform) {
    const error = new Error('Only TikTok and Pinterest public URLs are supported.');
    error.statusCode = 400;
    throw error;
  }

  parsed.hash = '';

  return {
    url: parsed.toString(),
    platform,
    hostname
  };
}

function detectPlatform(hostname) {
  const host = normalizeHostname(hostname);

  if (isTikTokHost(host)) return 'tiktok';
  if (isPinterestHost(host)) return 'pinterest';

  return null;
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

function isTikTokHost(hostname) {
  const host = normalizeHostname(hostname);
  return TIKTOK_HOSTS.has(host);
}

function isPinterestHost(hostname) {
  const host = normalizeHostname(hostname);
  return PINTEREST_HOSTS.has(host) || host.endsWith('.pinterest.com');
}

function isPinterestCdnHost(hostname) {
  const host = normalizeHostname(hostname);
  return PINTEREST_CDN_HOSTS.has(host) || host.endsWith('.pinimg.com');
}

function isAllowedDownloadHost(hostname) {
  return isPinterestCdnHost(hostname);
}

function isLocalOrIpHost(hostname) {
  const host = normalizeHostname(hostname);

  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }

  const ipVersion = net.isIP(host);

  if (!ipVersion) {
    return false;
  }

  return isPrivateIp(host);
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);

  if (version === 4) {
    const parts = ip.split('.').map((part) => Number(part));

    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }

    const [a, b] = parts;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();

    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('ff')
    );
  }

  return true;
}

async function assertPublicDns(hostname) {
  const host = normalizeHostname(hostname);

  if (isLocalOrIpHost(host)) {
    const error = new Error('Blocked unsafe host.');
    error.statusCode = 400;
    throw error;
  }

  let records;

  try {
    records = await dns.lookup(host, {
      all: true,
      verbatim: true
    });
  } catch {
    const error = new Error('Could not resolve host safely.');
    error.statusCode = 400;
    throw error;
  }

  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    const error = new Error('Blocked private network target.');
    error.statusCode = 400;
    throw error;
  }
}

async function safeFetch(urlInput, options = {}) {
  const {
    allowedHost,
    maxRedirects = 3,
    timeoutMs = 9000,
    headers = {},
    method = 'GET'
  } = options;

  let currentUrl;

  try {
    currentUrl = new URL(urlInput);
  } catch {
    const error = new Error('Invalid fetch URL.');
    error.statusCode = 400;
    throw error;
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (currentUrl.protocol !== 'https:') {
      const error = new Error('Only HTTPS fetch targets are allowed.');
      error.statusCode = 400;
      throw error;
    }

    const hostname = normalizeHostname(currentUrl.hostname);

    if (typeof allowedHost === 'function' && !allowedHost(hostname)) {
      const error = new Error('Fetch target is not in the allowed domain list.');
      error.statusCode = 403;
      throw error;
    }

    await assertPublicDns(hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;

    try {
      response = await fetch(currentUrl.toString(), {
        method,
        redirect: 'manual',
        headers,
        signal: controller.signal
      });
    } catch {
      const safeError = new Error('Could not fetch the public metadata safely.');
      safeError.statusCode = 502;
      throw safeError;
    } finally {
      clearTimeout(timeout);
    }

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');

      if (!location) {
        const error = new Error('Redirect location is missing.');
        error.statusCode = 400;
        throw error;
      }

      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return {
      response,
      finalUrl: currentUrl.toString()
    };
  }

  const error = new Error('Too many redirects.');
  error.statusCode = 400;
  throw error;
}

async function safeFetchText(urlInput, options = {}) {
  const maxBytes = Number(options.maxBytes || 1024 * 1024);
  const result = await safeFetch(urlInput, options);
  const buffer = await readBodyWithLimit(result.response, maxBytes);

  return {
    ...result,
    text: buffer.toString('utf8')
  };
}

async function safeFetchJson(urlInput, options = {}) {
  const result = await safeFetchText(urlInput, {
    ...options,
    maxBytes: Number(options.maxBytes || 512 * 1024),
    headers: {
      Accept: 'application/json,text/plain,*/*',
      ...(options.headers || {})
    }
  });

  try {
    return {
      ...result,
      json: JSON.parse(result.text)
    };
  } catch {
    const error = new Error('Invalid JSON response from metadata provider.');
    error.statusCode = 502;
    throw error;
  }
}

async function readBodyWithLimit(response, maxBytes) {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    totalBytes += value.byteLength;

    if (totalBytes > maxBytes) {
      const error = new Error('Response body is too large.');
      error.statusCode = 413;
      throw error;
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function isRedirectStatus(statusCode) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function sanitizeFileName(value) {
  const safe = String(value || 'pintok-download')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '');

  return safe || 'pintok-download';
}

module.exports = {
  validateInputUrl,
  detectPlatform,
  normalizeHostname,
  isTikTokHost,
  isPinterestHost,
  isPinterestCdnHost,
  isAllowedDownloadHost,
  safeFetch,
  safeFetchText,
  safeFetchJson,
  sanitizeFileName
};
