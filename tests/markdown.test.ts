// The markdown converter of the html export: each element it draws, and that text from the conversation can never
// become a tag, an attribute or a link that runs something.
import { expect, test } from 'claude-code/testing'
import { escapeHtml, inline, markdownToHtml, safeHref } from '../hooks/lib/markdown'

// Every tag the converter may write, with the only attributes it may carry: fixed classes, an ordered list's
// number, and an http, https or mailto href with its fixed rel.
const ALLOWED_TAG = new RegExp(
  '^<(?:/?(?:h[1-6]|p|strong|em|del|code|pre|ul|li|blockquote|table|thead|tbody|tr|div|th|td)' +
    '|br|hr|ol(?: start="[0-9]+")?|/ol|/a|a href="(?:https?:|mailto:)[^"<>]*" rel="noopener noreferrer"' +
    '|div class="(?:code|lang|table)"|t[hd] class="a-[lcr]")>$',
)

// Every `<` the output holds starts a tag of the list, and no text between the tags holds a raw `<`, `>`, `"` or `'`.
function expectOnlyOwnTags(html: string): void {
  for (const tag of html.match(/<[^>]*>?/g) ?? []) expect(ALLOWED_TAG.test(tag), tag).toBe(true)
  expect(html.replace(/<[^>]*>/g, '')).not.toMatch(/[<>"']/)
}

const TAB = String.fromCharCode(9)
const CONTROL = String.fromCharCode(1)

test('headings, paragraphs and line breaks', () => {
  expect(markdownToHtml('# One\n### Three ###\n###### Six')).toBe('<h1>One</h1>\n<h3>Three</h3>\n<h6>Six</h6>')
  expect(markdownToHtml('#hashtag is text')).toBe('<p>#hashtag is text</p>')
  expect(markdownToHtml('first line\nsecond line\n\nnext paragraph')).toBe('<p>first line<br>\nsecond line</p>\n<p>next paragraph</p>')
})

test('bold, italic, both, strikethrough, inline code and escaped marks', () => {
  expect(inline('**b** *i* ***bi*** ~~s~~ `a < b`')).toBe('<strong>b</strong> <em>i</em> <strong><em>bi</em></strong> <del>s</del> <code>a &lt; b</code>')
  expect(inline('**bold with `code` inside**')).toBe('<strong>bold with <code>code</code> inside</strong>')
  expect(inline('\\*not italic\\* and 2 * 3 * 4')).toBe('*not italic* and 2 * 3 * 4')
  expect(inline('``code with ` tick``')).toBe('<code>code with ` tick</code>')
})

test('fenced code blocks keep their text and show the language as a label', () => {
  expect(markdownToHtml('```ts\nconst a = 1 < 2\n```')).toBe('<div class="code"><div class="lang">ts</div><pre><code>const a = 1 &lt; 2</code></pre></div>')
  expect(markdownToHtml('~~~\n**not bold**\n~~~')).toBe('<div class="code"><pre><code>**not bold**</code></pre></div>')
  // An unclosed fence runs to the end.
  expect(markdownToHtml('```\nopen')).toBe('<div class="code"><pre><code>open</code></pre></div>')
})

test('lists: unordered, ordered with its first number, nested, with a code block, and task boxes', () => {
  expect(markdownToHtml('- a\n- b')).toBe('<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>')
  expect(markdownToHtml('3. c\n4. d')).toBe('<ol start="3">\n<li><p>c</p></li>\n<li><p>d</p></li>\n</ol>')
  expect(markdownToHtml('1. top\n  - inner *x*\n2. next')).toBe(
    '<ol>\n<li><p>top</p>\n<ul>\n<li><p>inner <em>x</em></p></li>\n</ul></li>\n<li><p>next</p></li>\n</ol>',
  )
  expect(markdownToHtml('1. run\n   ```sh\n   ls\n   ```')).toBe('<ol>\n<li><p>run</p>\n<div class="code"><div class="lang">sh</div><pre><code>ls</code></pre></div></li>\n</ol>')
  expect(markdownToHtml('- [x] done\n- [ ] todo')).toBe('<ul>\n<li><p>☑ done</p></li>\n<li><p>☐ todo</p></li>\n</ul>')
  // A list of the other kind starts a new list.
  expect(markdownToHtml('- a\n1. b')).toBe('<ul>\n<li><p>a</p></li>\n</ul>\n<ol>\n<li><p>b</p></li>\n</ol>')
})

test('quotes, tables, links and rules', () => {
  expect(markdownToHtml('> said **this**\n> > and that')).toBe('<blockquote>\n<p>said <strong>this</strong></p>\n<blockquote>\n<p>and that</p>\n</blockquote>\n</blockquote>')
  expect(markdownToHtml('| a | b | c |\n|:--|:-:|--:|\n| 1 | `2` | 3 \\| 4 |')).toBe(
    '<div class="table"><table><thead><tr><th class="a-l">a</th><th class="a-c">b</th><th class="a-r">c</th></tr></thead>' +
      '<tbody><tr><td class="a-l">1</td><td class="a-c"><code>2</code></td><td class="a-r">3 | 4</td></tr></tbody></table></div>',
  )
  expect(inline('[docs](https://example.com/a?b=1&c=2) <https://x.example> [mail](mailto:a@b.example) [plain](http://x.example)')).toBe(
    '<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">docs</a> <a href="https://x.example" rel="noopener noreferrer">https://x.example</a> ' +
      '<a href="mailto:a@b.example" rel="noopener noreferrer">mail</a> <a href="http://x.example" rel="noopener noreferrer">plain</a>',
  )
  // An image is only a link to it: nothing is loaded.
  expect(inline('![chart](https://x.example/c.png)')).toBe('<a href="https://x.example/c.png" rel="noopener noreferrer">chart</a>')
  expect(markdownToHtml('a\n\n---\n\n***\nb')).toBe('<p>a</p>\n<hr>\n<hr>\n<p>b</p>')
})

test('the output of every element uses only the converter\'s own tags', () => {
  const all = '# h\n\ntext **b** *i* ~~s~~ `c` [l](https://x.example)\n\n```js\nx\n```\n\n- a\n  1. b\n\n> q\n\n| a |\n|---|\n| b |\n\n---'
  expectOnlyOwnTags(markdownToHtml(all))
})

// Each of these, anywhere in a message, must come out as text: no script, no event attribute, no style, no link
// that is not http, https or mailto.
const ATTACKS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<style>body{display:none}</style>',
  '<div style="position:fixed;inset:0">covered</div>',
  '<<script>script>alert(1)<</script>/script>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](javascript&#58;alert(1))',
  `[x](java${TAB}script:alert(1))`,
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](vbscript:msgbox(1))',
  '[x](//evil.example/x)',
  `[x](https://ok${CONTROL}.example)`,
  '![x](javascript:alert(1))',
  '<javascript:alert(1)>',
  '[x](https://ok.example/"onmouseover="alert.1)',
  "[x](https://ok.example/'onmouseover='alert.1)",
  '[x](https://ok.example/"><script>alert.1</script>)',
  '[<img src=x onerror=alert(1)>](https://ok.example)',
  '[x](mailto:a@b.example?subject=<script>alert.1</script>)',
  '**<b onclick=alert(1)>bold</b>**',
  '`<script>alert(1)</script>`',
  '```html\n<script>alert(1)</script>\n</code></pre><script>alert(2)</script>\n```',
  '```"><script>alert(1)</script>\nx\n```',
  '```js" onmouseover="alert(1)\nx\n```',
  '| a | b |\n|---|---|\n| <script>alert(1)</script> | <img src=x onerror=1> |',
  '# <script>alert(1)</script>',
  '> <iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '- <style>*{color:red}</style>\n- [x](javascript:alert(1))',
]

test('XSS attempts come out as text: only the converter\'s tags, no script, no event or style attribute, no unsafe href', () => {
  for (const attack of ATTACKS) {
    const html = markdownToHtml(attack)
    expectOnlyOwnTags(html)
    expect(html, attack).not.toMatch(/<(?:script|img|svg|iframe|style)\b/i)
    expect(html, attack).not.toMatch(/<[^>]*\s(?:on[a-z]+|style|src|srcdoc)\s*=/i)
    expect(html, attack).not.toMatch(/href="(?!https?:|mailto:)/i)
  }
})

test('XSS: what the attacks look like after conversion', () => {
  expect(markdownToHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  // A link to anything but http, https or mailto stays as it was written, as text.
  expect(inline('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))')
  expect(inline('[x](data:text/html,hi)')).toBe('[x](data:text/html,hi)')
  // A quote in an allowed link is escaped inside the attribute and cannot end it.
  expect(inline('[x](https://ok.example/"onmouseover="alert.1)')).toBe(
    '<a href="https://ok.example/&quot;onmouseover=&quot;alert.1" rel="noopener noreferrer">x</a>',
  )
  expect(inline('[x](https://ok.example/"><script>alert.1</script>)')).toBe(
    '<a href="https://ok.example/&quot;&gt;&lt;script&gt;alert.1&lt;/script&gt;" rel="noopener noreferrer">x</a>',
  )
  // A code block is escaped whole, its closing tags included, and the fence's language is only a label.
  expect(markdownToHtml('```js" onmouseover="alert(1)\n</code></pre><script>\n```')).toBe(
    '<div class="code"><div class="lang">js&quot;</div><pre><code>&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;</code></pre></div>',
  )
  expect(markdownToHtml('&amp; &lt;b&gt;')).toBe('<p>&amp;amp; &amp;lt;b&amp;gt;</p>')
})

test('escapeHtml and safeHref', () => {
  expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  expect([safeHref('https://a.example'), safeHref('HTTP://a.example'), safeHref('mailto:a@b.example')]).toEqual(['https://a.example', 'HTTP://a.example', 'mailto:a@b.example'])
  for (const url of ['javascript:alert(1)', ' https://a.example', 'data:x', 'file:///etc/passwd', '/relative', `https://a${CONTROL}b`]) expect(safeHref(url), url).toBeNull()
})

test('deep nesting and very long lines stay bounded and escaped', () => {
  const deep = markdownToHtml(`${'> '.repeat(50)}<script>x</script>`)
  expectOnlyOwnTags(deep)
  expect((deep.match(/<blockquote>/g) ?? []).length).toBeLessThanOrEqual(10)
  const long = `${'**a '.repeat(3000)}<b>`
  const html = markdownToHtml(long)
  expectOnlyOwnTags(html)
  expect(html).toContain('&lt;b&gt;')
})

test('a heading or table row ending in many blanks converts in linear time', () => {
  const blanks = ' '.repeat(200_000)
  const started = Date.now()
  expect(markdownToHtml(`# a${blanks}x`)).toStartWith('<h1>a')
  expect(markdownToHtml(`|a|\n|-${blanks}x`)).not.toContain('<table>')
  expect(markdownToHtml(`|a|b|\n|-|-|${blanks}`)).toContain('<table>')
  expect(Date.now() - started).toBeLessThan(2000)
})

test('a heading drops its closing #s only after a blank', () => {
  expect(markdownToHtml('## Title ##')).toBe('<h2>Title</h2>')
  expect(markdownToHtml('# C#')).toBe('<h1>C#</h1>')
  expect(markdownToHtml('# #')).toBe('<h1></h1>')
  expect(markdownToHtml('#')).toBe('<h1></h1>')
  expect(markdownToHtml('### a \t ')).toBe('<h3>a</h3>')
})
