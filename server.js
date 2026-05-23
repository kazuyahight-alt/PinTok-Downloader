'use strict';

require('dotenv').config();

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { analyzeTikTok } = require('./services/tiktok');
const { analyzePinterest } = require('./services/pinterest');
const {
  validateInputUrl,
  safeFetch,
  isAllowedDownloadHost,
  sanitizeFileName
} = require('./services/urlValidator');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const MAX_DOWNLOAD_BYTES = Number(process.env.MAX_DOWNLOAD_BYTES || 15 * 1024 * 1024);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (configuredOrigins.length > 0) {
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || configuredOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error('Origin is not allowed by CORS.'));
      },
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type']
    })
  );
} else {
  app.use(cors());
}

app.use(express.json({ limit: '25kb' }));

app.use(
  '/api',
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    limit: Number(process.env.RATE_LIMIT_MAX || 80),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests. Please wait a moment before trying again.'
    }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    name: 'PinTok Downloader',
    status: 'ok',
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/analyze', async (req, res, next) => {
  try {
    const rawUrl = req.body?.url;
    const validation = validateInputUrl(rawUrl);

    if (validation.platform === 'tiktok') {
      const result = await analyzeTikTok(validation.url);
      return res.json(result);
    }

    if (validation.platform === 'pinterest') {
      const result = await analyzePinterest(validation.url);
      return res.json(result);
    }

    return res.status(400).json({
      success: false,
      message: 'Only TikTok and Pinterest public URLs are supported.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/download', async (req, res, next) => {
  try {
    const downloadUrl = String(req.body?.downloadUrl || '').trim();
    const title = String(req.body?.title || 'pintok-download').trim();

    if (!downloadUrl) {
      return res.status(400).json({
        success: false,
        message: 'Download URL is required.'
      });
    }

    const parsed = new URL(downloadUrl);

    if (parsed.protocol !== 'https:') {
      return res.status(400).json({
        success: false,
        message: 'Only HTTPS download URLs are allowed.'
      });
    }

    if (!isAllowedDownloadHost(parsed.hostname)) {
      return res.status(403).json({
        success: false,
        message: 'This media host is not allowed for safe download.'
      });
    }

    const fetchResult = await safeFetch(parsed.toString(), {
      allowedHost: isAllowedDownloadHost,
      maxRedirects: 2,
      timeoutMs: 12000,
      headers: {
        'User-Agent': 'PinTokDownloader/1.0',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8'
      }
    });

    const downloadResponse = fetchResult.response;

    if (!downloadResponse.ok) {
      return res.status(502).json({
        success: false,
        message: 'The media file could not be fetched safely.'
      });
    }

    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream';

    if (!contentType.toLowerCase().startsWith('image/')) {
      return res.status(403).json({
        success: false,
        message: 'Only safe public image downloads are supported in this build.'
      });
    }

    const contentLength = Number(downloadResponse.headers.get('content-length') || 0);

    if (contentLength > MAX_DOWNLOAD_BYTES) {
      return res.status(413).json({
        success: false,
        message: 'The file is too large for safe download.'
      });
    }

    const extension = getExtensionFromContentType(contentType);
    const fileName = `${sanitizeFileName(title || 'pintok-download')}${extension}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');

    if (contentLength > 0) {
      res.setHeader('Content-Length', String(contentLength));
    }

    const reader = downloadResponse.body.getReader();
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > MAX_DOWNLOAD_BYTES) {
        res.destroy(new Error('File exceeded safe download size limit.'));
        return;
      }

      res.write(Buffer.from(value));
    }

    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    next(error);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err,
