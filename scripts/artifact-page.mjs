// Rewrites the built index.html into the form a Claude artifact expects: page
// content only (the host adds the document skeleton), with the title first.
import { readFileSync, writeFileSync } from 'node:fs'

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
console.log(`artifact page written: ${styles.length} stylesheet(s), ${scripts.length} script(s)`)
