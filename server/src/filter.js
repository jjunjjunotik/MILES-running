'use strict';

/* The first line of moderation: names, crew details, notices and plot names
   are checked against data/blocklist.txt before they are saved. It catches
   the obvious; reports and the admin queue catch the rest. */

const fs = require('fs');
const path = require('path');
const { fail } = require('./http');

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[0134578@$!|]/g, (c) => LEET[c])
    .replace(/(.)\1+/gu, '$1');
}

function compile(source) {
  const words = new Set();
  const anywhere = [];
  source.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (line.startsWith('~')) anywhere.push(normalize(line.slice(1)));
    else words.add(normalize(line));
  });
  return { words, anywhere: anywhere.filter(Boolean) };
}

const LIST = compile(fs.readFileSync(path.resolve(__dirname, '../data/blocklist.txt'), 'utf8'));

/** The first blocked word found in the text, or null. */
function findBlocked(text, list) {
  const l = list || LIST;
  const tokens = normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const t of tokens) if (l.words.has(t)) return t;
  const compact = tokens.join('');
  for (const w of l.anywhere) if (compact.includes(w)) return w;
  return null;
}

/** Throws a 422 the app can show as it is, if the text is not allowed. */
function assertClean(text, what) {
  if (text && findBlocked(text)) {
    throw fail.invalid(`That ${what || 'text'} contains words that are not allowed on MILES.`, 'blocked_words');
  }
  return text;
}

module.exports = { normalize, compile, findBlocked, assertClean };
