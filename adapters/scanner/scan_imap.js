const { ImapFlow } = require('imapflow');
const { htmlToText } = require('html-to-text');

function atStartOfDayNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function includesAny(s, needles) {
  if (!needles?.length) return true;
  const low = String(s || '').toLowerCase();
  return needles.some(n => low.includes(String(n).toLowerCase()));
}

exports.scanMailbox = async function scanMailbox(opts = {}) {
  const {
    daysBack = 7,
    fromIncludes = [],
    subjectIncludes = [],
    headlinesOnly = false
  } = opts;

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: String(process.env.IMAP_SECURE ?? 'true') === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const sinceDate = atStartOfDayNDaysAgo(daysBack);
  const out = [];

  await client.connect();
  try {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const uids = await client.search({ since: sinceDate });

    for await (const msg of client.fetch(uids, { envelope: true, source: true })) {
      const fromAddr = msg.envelope?.from?.map(f => `${f.mailbox}@${f.host}`).join(', ') || '';
      const subject = msg.envelope?.subject || '';
      const date = msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null;

      if (!includesAny(fromAddr, fromIncludes)) continue;
      if (!includesAny(subject, subjectIncludes)) continue;

      let snippet;
      if (!headlinesOnly) {
        const raw = msg.source?.toString() || '';
        snippet = htmlToText(raw, { wordwrap: false }).slice(0, 600) || undefined;
      }

      out.push({ source: fromAddr, subject, date, snippet });
    }

    out.sort((a, b) => new Date(b.date) - new Date(a.date));
    return out;
  } finally {
    await client.logout().catch(() => {});
  }
};
