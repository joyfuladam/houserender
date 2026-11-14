// Rewrites the built index.html into the form a Claude artifact expects: page
// content only (the host adds the document skeleton), with the title first.
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const dir = process.argv[2] ?? 'dist-artifact'
const html = readFileSync(`${dir}/index.html`, 'utf8')
const tags = (re) => [...html.matchAll(re)].map((m) => m[0].replace(/\s+crossorigin/g, ''))

const title = html.match(/<title>.*?<\/title>/s)?.[0] ?? '<title>House Render</title>'
const styles = tags(/<link[^>]+rel="stylesheet"[^>]*>/g)
const scripts = tags(/<script[^>]*src="[^"]+"[^>]*><\/script>/g)
if (!scripts.length) throw new Error('No script tag found in the built page')

writeFileSync(
  `${dir}/index.html`,
  [title, '<meta name="claude:viewport-fit-sides" content="cover">', ...styles, '<div id="root"></div>', ...scripts].join('\n') + '\n',
)
// The real house lives in private/ (not committed); the repo only carries a
// sample. Publish the real one when it is there.
if (existsSync('private/data')) {
  for (const f of readdirSync('private/data').filter((n) => n.endsWith('.json'))) copyFileSync(`private/data/${f}`, `${dir}/data/${f}`)
  console.log('using house data from private/data')
}

console.log(`artifact page written: ${styles.length} stylesheet(s), ${scripts.length} script(s)`)
