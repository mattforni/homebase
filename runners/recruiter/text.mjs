#!/usr/bin/env node
// The recruiter runner's deterministic extraction, so the model reads text and
// JSON rather than pages. Three modes, no dependencies, node 20:
//
//   text.mjs getro <page.html>
//       The listings a Getro board rendered into its Next.js state, as JSON
//       {"found": [...], "total": n} on stdout. The page holds the first
//       twenty for a query; total says how many the board had.
//   text.mjs html <page.html> <base-url>
//       The page as plain text on stdout, one line per block, links kept as
//       [text](absolute url) so a listing can still be followed.
//   text.mjs rss <feed.xml> <out-dir>
//       One markdown file per item (title, link, date, then the post as text)
//       plus an index.md, newest first, so a reader can pick only what is new.
//
// A page that does not carry what a mode expects exits 2 with the reason on
// stderr; the entrypoint records that as a failed pull rather than dying.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’',
    lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•',
};
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
});

const absolute = (href, base) => {
    try { return new URL(href, base).toString(); } catch { return href; }
};

// HTML to lines of text. Anchors survive as markdown links; block closers
// become line breaks; everything else is stripped.
const strip = (html, base) => {
    let t = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
            const text = decode(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
            if (!text) return ' ';
            return base ? ` [${text}](${absolute(href, base)}) ` : ` [${text}](${href}) `;
        })
        .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/header|\/footer|\/blockquote)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    t = decode(t);
    return t.split('\n')
        .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
};

const fail = (why) => { process.stderr.write(`${why}\n`); process.exit(2); };

const [mode, file, extra] = process.argv.slice(2);
if (!mode || !file) fail('usage: text.mjs getro <html> | html <html> <base-url> | rss <xml> <out-dir>');
const raw = readFileSync(file, 'utf8');

if (mode === 'getro') {
    const open = raw.indexOf('<script id="__NEXT_DATA__"');
    if (open < 0) fail('no __NEXT_DATA__ script in the page');
    const start = raw.indexOf('>', open) + 1;
    const end = raw.indexOf('</script>', start);
    if (end < 0) fail('unterminated __NEXT_DATA__ script');
    let state;
    try { state = JSON.parse(raw.slice(start, end)); } catch (e) { fail(`__NEXT_DATA__ is not JSON: ${e.message}`); }
    const jobs = state?.props?.pageProps?.initialState?.jobs;
    if (!jobs || !Array.isArray(jobs.found)) fail('no jobs.found in the page state');
    process.stdout.write(JSON.stringify({ found: jobs.found, total: jobs.total ?? null }));
} else if (mode === 'html') {
    process.stdout.write(strip(raw, extra) + '\n');
} else if (mode === 'rss') {
    if (!extra) fail('rss needs an output directory');
    const items = raw.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    if (!items.length) fail('no <item> elements in the feed');
    mkdirSync(extra, { recursive: true });
    const field = (item, tag) => {
        const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
        if (!m) return '';
        return decode(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim();
    };
    const index = [];
    for (const item of items) {
        const title = field(item, 'title');
        const link = field(item, 'link');
        const date = new Date(field(item, 'pubDate'));
        const day = Number.isNaN(date.getTime()) ? 'undated' : date.toISOString().slice(0, 10);
        const bodyRaw = (item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) ?? [, ''])[1]
            .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
        const slug = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        const name = `${day}-${slug}.md`;
        writeFileSync(join(extra, name), `# ${title}\n\n${link}\n${day}\n\n${strip(bodyRaw, link)}\n`);
        index.push({ day, title, name, link });
    }
    index.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    writeFileSync(join(extra, 'index.md'),
        `# a16z Jobs issues, newest first\n\n${index.map((i) => `- ${i.day} · ${i.title} · ${i.name} · ${i.link}`).join('\n')}\n`);
    process.stdout.write(`${index.length} items\n`);
} else {
    fail(`unknown mode ${mode}`);
}
