'use strict';

const rateStore = new Map();

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 30;

module.exports = async function handler(req, res) {
  try {
    setCors(res);

    if (req.method === 'OPTIONS') {
      return sendJson(res, 200, { success: true });
    }

    if (!rateLimit(req)) {
      return sendJson(res, 429, {
        success: false,
        message: 'Too many requests. Please wait a moment.'
      });
    }

    const path = getPath(req.url);

    if (req.method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, {
        success: true,
        name: 'PinTok Downloader',
        status: 'ok',
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST' && path === '/api/analyze') {
      const body = await readJsonBody(req);
      const inputUrl = String(body.url || '').trim();

      const validation = validateUrl(inputUrl);

      if (!validation.valid) {
        return sendJson(res, 400, {
          success: false,
          message: validation.message
        });
      }

      if (validation.platform === 'tiktok') {
        const result = await analyzeTikTok(validation.url);
        return sendJson(res, 200, result);
      }

      if (validation.platform === 'pinterest') {
        const result = await analyzePinterest(validation.url);
        return sendJson(res, 200, result);
      }

      return sendJson(res, 400, {
        success: false,
        message: 'Only TikTok and Pinterest URLs are supported.'
      });
    }

    if (req.method === 'POST' && path === '/api/download') {
      const body = await readJsonBody(req);
      const downloadUrl = String(body.downloadUrl || '').trim();
      const title = String(body.title || 'pintok-download').trim();

      return downloadPinterestImage(res, downloadUrl, title);
    }

    return sendJson(res, 404, {
      success: false,
      message: 'API route not found.'
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      message: error.message || 'Internal server error.'
    });
  }
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getPath(url) {
  try {
    return new URL(url, 'https://pintok.local').pathname;
  } catch {
    return '/';
  }
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;

      if (raw.length > 100000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!raw) return resolve({});

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function rateLimit(req) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const now = Date.now();
  const current = rateStore.get(ip);

  if (!current || now - current.startedAt > RATE_LIMIT_WINDOW) {
    rateStore.set(ip, {
      startedAt: now,
      count: 1
    });

    return true;
  }

  current.count += 1;

  if (current.count > RATE_LIMIT_MAX) {
    return false;
  }

  return true;
}

function validateUrl(inputUrl) {
  if (!inputUrl) {
    return {
      valid: false,
      message: 'Please paste a URL first.'
    };
  }

  let parsed;

  try {
    parsed = new URL(inputUrl);
  } catch {
    return {
      valid: false,
      message: 'Invalid URL format.'
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      message: 'Only HTTPS URLs are allowed.'
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      message: 'URLs with username or password are not allowed.'
    };
  }

  const host = parsed.hostname.toLowerCase();

  const isTikTok = [
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'vm.tiktok.com',
    'vt.tiktok.com'
  ].includes(host);

  const isPinterest =
    [
      'pinterest.com',
      'www.pinterest.com',
      'id.pinterest.com',
      'pin.it',
      'www.pin.it'
    ].includes(host) || host.endsWith('.pinterest.com');

  if (!isTikTok && !isPinterest) {
    return {
      valid: false,
      message: 'Only TikTok and Pinterest URLs are supported.'
    };
  }

  return {
    valid: true,
    url: parsed.toString(),
    platform: isTikTok ? 'tiktok' : 'pinterest'
  };
}

async function analyzeTikTok(url) {
  try {
    const oembed = new URL('https://www.tiktok.com/oembed');
    oembed.searchParams.set('url', url);

    const response = await fetch(oembed.toString(), {
      headers: {
        'User-Agent': 'PinTokDownloader/1.0',
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return previewOnlyTikTok();
    }

    const data = await response.json();

    return {
      success: true,
      platform: 'tiktok',
      type: 'video',
      title: cleanText(data.title || 'TikTok content'),
      author: cleanText(data.author_name || 'Unknown'),
      thumbnail: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null,
      duration: null,
      downloadable: false,
      downloadUrl: null,
      status: 'preview_only',
      message: 'TikTok preview loaded. Direct video download is not provided because this app does not bypass platform protection, private content, login-only content, or watermark behavior.'
    };
  } catch {
    return previewOnlyTikTok();
  }
}

function previewOnlyTikTok() {
  return {
    success: true,
    platform: 'tiktok',
    type: 'video',
    title: 'TikTok content',
    author: 'Unknown',
    thumbnail: null,
    duration: null,
    downloadable: false,
    downloadUrl: null,
    status: 'preview_only',
    message: 'TikTok preview is limited for this URL. Private, removed, restricted, or login-only content is not supported.'
  };
}

async function analyzePinterest(url) {
  try {
    const html = await safeFetchText(url);
    const meta = extractMeta(html);

    const thumbnail = meta.image;
    const downloadable = Boolean(thumbnail && isPinterestImage(thumbnail));

    return {
      success: true,
      platform: 'pinterest',
      type: thumbnail ? 'image' : 'unknown',
      title: meta.title || 'Pinterest content',
      author: meta.author || 'Unknown',
      thumbnail,
      duration: null,
      downloadable,
      downloadUrl: downloadable ? thumbnail : null,
      status: downloadable ? 'downloadable' : 'preview_only',
      message: downloadable
        ? 'Public Pinterest image preview is available for download. Only use it if you own the content or have permission.'
        : 'Preview loaded, but no safe legal direct download file is available.'
    };
  } catch {
    return {
      success: true,
      platform: 'pinterest',
      type: 'unknown',
      title: 'Pinterest content',
      author: 'Unknown',
      thumbnail: null,
      duration: null,
      downloadable: false,
      downloadUrl: null,
      status: 'preview_only',
      message: 'Pinterest preview is limited for this URL. Private, login-only, protected, or unavailable content is not supported.'
    };
  }
}

async function safeFetchText(url) {
  let current = new URL(url);

  for (let i = 0; i < 4; i += 1) {
    if (current.protocol !== 'https:') {
      throw new Error('Only HTTPS fetch is allowed.');
    }

    if (!isAllowedPinterestHost(current.hostname)) {
      throw new Error('Host is not allowed.');
    }

    const response = await fetch(current.toString(), {
      redirect: 'manual',
      headers: {
        'User-Agent': 'PinTokDownloader/1.0',
        Accept: 'text/html,application/xhtml+xml'
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');

      if (!location) {
        throw new Error('Redirect location missing.');
      }

      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new Error('Could not fetch public page.');
    }

    return response.text();
  }

  throw new Error('Too many redirects.');
}

function extractMeta(html) {
  const title =
    getMeta(html, 'og:title') ||
    getMeta(html, 'twitter:title') ||
    getTitle(html) ||
    'Pinterest content';

  const author =
    getMeta(html, 'pinterestapp:author') ||
    getMeta(html, 'article:author') ||
    'Unknown';

  const image =
    getMeta(html, 'og:image') ||
    getMeta(html, 'twitter:image') ||
    null;

  return {
    title: cleanText(decodeHtml(title)),
    author: cleanText(decodeHtml(author)),
    image: normalizeImageUrl(image)
  };
}

function getMeta(html, key) {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patternA = new RegExp(
    `<meta[^>]+(?:property|name)=["']${safeKey}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    'i'
  );

  const patternB = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${safeKey}["'][^>]*>`,
    'i'
  );

  const match = html.match(patternA) || html.match(patternB);
  return match ? match[1].trim() : null;
}

function getTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

function normalizeImageUrl(value) {
  if (!value) return null;

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== 'https:') return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

function isPinterestImage(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      isPinterestCdnHost(parsed.hostname) &&
      /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isAllowedPinterestHost(hostname) {
  const host = String(hostname || '').toLowerCase();

  return (
    host === 'pinterest.com' ||
    host === 'www.pinterest.com' ||
    host === 'id.pinterest.com' ||
    host === 'pin.it' ||
    host === 'www.pin.it' ||
    host.endsWith('.pinterest.com')
  );
}

function isPinterestCdnHost(hostname) {
  const host = String(hostname || '').toLowerCase();

  return (
    host === 'i.pinimg.com' ||
    host === 's.pinimg.com' ||
    host === 'v.pinimg.com' ||
    host.endsWith('.pinimg.com')
  );
}

async function downloadPinterestImage(res, downloadUrl, title) {
  if (!downloadUrl) {
    return sendJson(res, 400, {
      success: false,
      message: 'Download URL is required.'
    });
  }

  let parsed;

  try {
    parsed = new URL(downloadUrl);
  } catch {
    return sendJson(res, 400, {
      success: false,
      message: 'Invalid download URL.'
    });
  }

  if (!isPinterestImage(parsed.toString())) {
    return sendJson(res, 403, {
      success: false,
      message: 'Only safe public Pinterest image downloads are supported.'
    });
  }

  const response = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': 'PinTokDownloader/1.0',
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*'
    }
  });

  if (!response.ok) {
    return sendJson(res, 502, {
      success: false,
      message: 'Could not fetch image safely.'
    });
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';

  if (!contentType.startsWith('image/')) {
    return sendJson(res, 403, {
      success: false,
      message: 'Only image files are supported.'
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const ext = getImageExtension(contentType);
  const fileName = `${sanitizeFileName(title)}${ext}`;

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.end(buffer);
}

function getImageExtension(contentType) {
  const type = contentType.split(';')[0].trim().toLowerCase();

  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif'
  };

  return map[type] || '.jpg';
}

function sanitizeFileName(value) {
  return String(value || 'pintok-download')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '') || 'pintok-download';
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
      }
