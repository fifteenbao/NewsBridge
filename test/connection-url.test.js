import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionUrl } from '../src/lib/connection-url.js';

test('connection URLs normalize root and nested paths with one trailing slash', () => {
  for (const [input, expected] of [
    ['https://example.com', '/'], ['https://example.com/', '/'],
    ['https://example.com/readflow', '/readflow/'], ['https://example.com/readflow/', '/readflow/'],
    ['https://example.com/tools/news-bridge_v2/', '/tools/news-bridge_v2/'],
  ]) assert.deepEqual(parseConnectionUrl(input), { baseUrl: 'https://example.com' + expected, origin: 'https://example.com', apiPath: expected + 'v1/' });
});
test('ambiguous URLs cannot inject CSP, escape the prefix or carry credentials', () => {
  for (const value of [null, '', 'http://example.com/app/', 'https://u:p@example.com/app/', 'https://example.com/a?x=1',
    'https://example.com/a#frag', 'https://example.com/a?', 'https://example.com/a#', 'https://example.com/a/../b/',
    'https://example.com/a/./', 'https://example.com/a//', 'https://example.com/%2fadmin/', 'https://example.com/%252fadmin/',
    'https://example.com/a\\b/', 'https://example.com/a;connect-src/', 'https://example.com/*/', 'https://*.example.com/app/', 'https://example.com;evil/app/', 'https://localhost/app/']) {
    assert.throws(() => parseConnectionUrl(value));
  }
});
