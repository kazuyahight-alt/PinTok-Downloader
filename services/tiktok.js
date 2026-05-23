'use strict';

const {
  validateInputUrl,
  safeFetchJson,
  isTikTokHost
} = require('./urlValidator');

async function analyzeTikTok(rawUrl) {
  const validation = validateInputUrl(rawUrl);

  if (validation.platform !== 'tiktok') {
    const error = new Error('This is not a TikTok URL.');
    error.statusCode = 400;
    throw error;
  }

  const oEmbedUrl = new URL('https://www.tiktok.com/oembed');
  oEmbedUrl.searchParams.set('url', validation.url);

  try {
    const result = await safeFetchJson(oEmbedUrl.toString(), {
      allowedHost: isTikTokHost,
      maxRedirects: 0,
      timeoutMs: 9000,
      maxBytes: 512 * 1024,
      headers: {
        'User-Agent': 'PinTokDownloader/1.0'
      }
    });

    if (!result.response.ok) {
      return createTikTokPreviewOnlyResponse({
        title: 'TikTok content',
        author: 'Unknown',
        thumbnail: null,
        message: 'TikTok metadata is not available for this public link. Private, removed, or restricted content is not supported.'
      });
    }

    const data = result.json || {};

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
      message: 'Preview loaded from TikTok oEmbed. Direct video download is not provided because this app does not bypass platform protection, login-only content, private content, or watermark behavior.'
    };
  } catch {
    return createTikTokPreviewOnlyResponse({
      title: 'TikTok content',
      author: 'Unknown',
      thumbnail: null,
      message: 'TikTok preview is limited for this URL. The app will not bypass private, login-only, protected, or unavailable content.'
    });
  }
}

function createTikTokPreviewOnlyResponse({ title, author, thumbnail, message }) {
  return {
    success: true,
    platform: 'tiktok',
    type: 'video',
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

module.exports = {
  analyzeTikTok
};
