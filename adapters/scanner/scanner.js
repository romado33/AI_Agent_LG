// Lightweight Gmail scanner API.
// Endpoints: GET /healthz, POST /scan_jobs, POST /scan_subscriptions, POST /scan_news
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { scanMailbox } = require('./scan_imap');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.SCANNER_PORT || 5057);
const MOCK = process.env.SCANNER_MOCK === '1';

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

async function handleScan(res, opts) {
  if (MOCK) {
    return res.json({
      status: 'ok',
      mode: 'mock',
      items: [
        { source: 'TLDR AI', subject: 'AI Daily — Mock A', date: new Date().toISOString(), link: 'https://example.com/a' },
        { source: 'Neuron', subject: 'AI Digest — Mock B', date: new Date().toISOString(), link: 'https://example.com/b' }
      ]
    });
  }
  try {
    const items = await scanMailbox(opts);
    res.json({ status: 'ok', mode: 'live', items });
  } catch (err) {
    console.error('scan error:', err);
    res.status(500).json({ status: 'error', error: String(err?.message || err) });
  }
}

app.post('/scan_jobs', async (req, res) => {
  await handleScan(res, {
    daysBack: req.body?.daysBack ?? 7,
    fromIncludes: [
      'no-reply@linkedin.com',
      'jobs-noreply@indeed.com',
      'workablemail.com',
      'lever.co',
      'greenhouse.io'
    ],
    subjectIncludes: ['job alert', 'new role', 'position', 'opening']
  });
});

app.post('/scan_subscriptions', async (req, res) => {
  await handleScan(res, {
    daysBack: req.body?.daysBack ?? 7,
    fromIncludes: [
      'newsletter@tldr.tech',
      'news@theneurondaily.com',
      'ben@bensbites.co',
      'hello@latentspace.dev'
    ],
    subjectIncludes: ['ai', 'daily', 'digest', 'newsletter', 'roundup']
  });
});

app.post('/scan_news', async (req, res) => {
  await handleScan(res, {
    daysBack: req.body?.daysBack ?? 2,
    fromIncludes: [
      'newsletter@tldr.tech',
      'news@theneurondaily.com',
      'ben@bensbites.co',
      'hello@latentspace.dev'
    ],
    subjectIncludes: ['ai', 'daily', 'digest', 'newsletter'],
    headlinesOnly: true
  });
});

app.listen(PORT, () => {
  console.log(`Scanner listening on http://127.0.0.1:${PORT}`);
});
