'use strict';

const {
  validateInputUrl,
  safeFetchText,
  isPinterestHost,
  isPinterestCdnHost
} = require('./urlValidator');

const ALLOW_PINTEREST_IMAGE_DOWNLOADS =
  String(process.env.ALLOW_PINTEREST_IMAGE_DOWNLOADS || 'true').toLowerCase() === 'true';

async function analyzePinterest(rawUrl) {
  const validation = validateInputUrl(rawUrl);

  if (validation.platform !== 'pinterest') {
    const error = new Error('This is not a Pinterest URL.');
    error.statusCode = 400;
    throw error;
  }

  try {
    const result = await safeFetchText(validation.url, {
      allowedHost: isPinterestHost,
      maxRedirects: 4,
      timeoutMs: 10000,
      maxBytes: 1024 * 1024,
      headers: {
        'User-Agent': 'PinTokDownloader/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!result.response.ok) {
      return createPinterestPreviewOnlyResponse({
        title: 'Pinterest content',
        author: 'Unknown',
        thumbnail: null,
        message: 'Pinterest metadata could not be accessed safely. Private, login-only, or restricted content is not supported.'
      });
    }

    const metadata = extractPinterestMetadata(result.text);
    const thumbnail = metadata.thumbnail;

    const downloadAllowed =
      ALLOW_PINTEREST_IMAGE_DOWNLOADS &&
      thumbnail &&
      isSafePinterestImageUrl(thumbnail);

    return {
      success: true,
      platform: 'pinterest',
      type: metadata.type,
      title: metadata.title || 'Pinterest content',
      author: metadata.author || 'Unknown',
      thumbnail,
      duration: null,
      downloadable: Boolean(downloadAllowed),
      downloadUrl: downloadAllowed ? thumbnail : null,
      status: downloadAllowed ? 'downloadable' : 'preview_only',
      message: downloadAllowed
        ? 'Public Pinterest image preview is available for download. Only use it if you own the content or have permission.'
        : 'Preview loaded, but no safe legal direct download file is available from allowed public metadata.'
    };
  } catch {
    return createPinterestPreviewOnlyResponse({
      title: 'Pinterest content',
      author: 'Unknown',
      thumbnail: null,
      message: 'Pinterest preview is limited for this URL. The app will not bypass private, login-only, protected, or unavailable content.'
    });
  }
}

function extractPinterestMetadata(html) {
  const title =
    getMetaContent(html, 'og:title') ||
    getMetaContent(html, 'twitter:title') ||
    extractTitleTag(html) ||
    'Pinterest content';

  const description =
    getMetaContent(html, 'og:description') ||
    getMetaContent(html, 'description') ||
    '';

  const author =
    getMetaContent(html, 'pinterestapp:author') ||
    getMetaContent(html, 'article:author') ||
    getAuthorFromDescription(description) ||
    'Unknown';

  const image =
    getMetaContent(html, 'og:image') ||
    getMetaContent(html, 'twitter:image') ||
    getMetaContent(html, 'thumbnail') ||
    null;

  const video =
    getMetaContent(html, 'og:video') ||
    getMetaContent(html, 'og:video:url') ||
    null;

  return {
    title: cleanText(decodeHtml(title)),
    author: cleanText(decodeHtml(author)),
    thumbnail: normalizeHttpsUrl(image),
    type: video ? 'video' : image ? 'image' : 'unknown'
  };
}

function getMetaContent(html, key) {
  const escapedKey = escapeRegExp(key);

  const patternA = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapedKey}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    'i'
  );

  const patternB = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escapedKey}["'][^>]*>`,
    'i'
  );

  const match = html.match(patternA) || html.match(patternB);
  return match ? match[1].trim() : null;
}

function extractTitleTag(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

function getAuthorFromDescription(description) {
  const clean = cleanText(description);

  if (!clean) return null;

  const byMatch = clean.match(/\bby\s+([^|•-]{2,80})/i);

  if (byMatch) {
    return byMatch[1].trim();
  }

  return null;
}

function isSafePinterestImageUrl(value) {
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

function normalizeHttpsUrl(value) {
  if (!value) return null;

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== 'https:') return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

function createPinterestPreviewOnlyResponse({ title, author, thumbnail, message }) {
  return {
    success: true,
    platform: 'pinterest',
    type: thumbnail ? 'image' : 'unknown',
    title,
    author,
    thumbnail,
    duration: null,
    downloadable: false,
    downloadUrl: null,
    status: 'preview_only',
    message
  };
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  analyzePinterest
};
