// The org board: a role card that can say what a role actually is, and a
// field that is quick to move around in.
//
// Three things are checked here, and the first is the one with teeth:
//
//   THE TWO MARKS, AND NOTHING ELSE. lib/richtext.js reads **bold** and
//   bullet lines and treats every other character as text. That is a parser
//   handed whatever an admin types, drawn on a page other admins read, so the
//   test that matters is the one that feeds it the things people actually
//   type by accident — a lone asterisk, an unclosed pair, a tag.
//
//   A LIST HAS TO FIT. The note field was capped at 160 characters when it
//   was one line. A list of duties is not one line, and a cap that silently
//   truncates one is the board losing work nobody watched it lose.
//
//   THE CARD DRAWS IT. Bullets as bullets, bold as bold, on the card itself
//   — checked in a browser, because "it parses" and "it is readable at 190px
//   wide" are different claims.
//
// Self-contained: port 4131.
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = new URL('.', import.meta.url).pathname
const PORT = 4131
const B = `http://localhost:${PORT}`

let fails = 0
const found = []
const ok = (id, n, c, x = '') => {
  if (!c) { fails++; found.push(`${id} ${n}${x ? ` — ${x}` : ''}`) }
  console.log(`${c ? '✔' : '✘ FAIL'} [${id}] ${n}${x ? ` — ${x}` : ''}`)
}
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })
procs.push(spawn(process.execPath, [ROOT + '/server/index.js'],
  { env: { ...process.env, DATA_DIR: SP + 'bd-' + Date.now(), PORT: String(PORT) }, stdio: 'ignore' }))
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(B + '/api/health')).ok) break } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const login = async (u, p) => (await (await fetch(B + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (path, method = 'GET', body, tok = T) => {
  const r = await fetch(B + '/api' + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

console.log('\n=== A. the two marks ===')
const { parseRich, inlineSpans, isPlain } = await import(ROOT + '/client/src/lib/richtext.js')
const kinds = (t) => parseRich(t).map((b) => b.type).join(',')
ok('A1', 'a plain line is a plain line', kinds('Owns the channel') === 'p')
ok('A2', 'three dashes are one list, not three',
  kinds('- plan\n- shoot\n- publish') === 'ul', kinds('- plan\n- shoot\n- publish'))
ok('A3', 'a heading line above a list keeps its own place',
  kinds('**Owns**\n- plan\n- shoot') === 'p,ul', kinds('**Owns**\n- plan\n- shoot'))
ok('A4', 'a note and a list and a note keep their order',
  kinds('one line\n- a\n- b\nlast line') === 'p,ul,p', kinds('one line\n- a\n- b\nlast line'))
const three = parseRich('- plan\n- shoot\n- publish')[0]
ok('A5', '…and the list really holds all three', three.items.length === 3, String(three.items.length))
ok('A6', 'bullets may be typed as -, * or •',
  kinds('* a\n• b\n- c') === 'ul' && parseRich('* a\n• b\n- c')[0].items.length === 3)
ok('A7', 'bold is bold and the text around it survives',
  JSON.stringify(inlineSpans('a **b** c')) === JSON.stringify([{ t: 'a ' }, { t: 'b', b: true }, { t: ' c' }]),
  JSON.stringify(inlineSpans('a **b** c')))
ok('A8', 'a blank line closes a list rather than joining two',
  kinds('- a\n\n- b') === 'ul,ul', kinds('- a\n\n- b'))

// The things people type by accident. None of these may throw, and none may
// quietly eat the text around them.
const survives = (t) => {
  const flat = parseRich(t).flatMap((b) => (b.type === 'ul' ? b.items.flat() : b.spans)).map((s) => s.t).join('')
  return flat
}
ok('A9', 'a lone asterisk is an asterisk', survives('2 * 3 = 6').includes('*'), survives('2 * 3 = 6'))
ok('A10', 'an unclosed bold stays literal rather than swallowing the rest',
  survives('**not closed here').includes('**not closed here'), survives('**not closed here'))
ok('A11', 'empty bold marks are left alone', survives('a ** ** b').length > 0, survives('a ** ** b'))
ok('A12', 'a tag typed into the box is text, never markup',
  survives('<script>alert(1)</script>').includes('<script>'), survives('<script>alert(1)</script>'))
ok('A13', 'nothing at all is nothing at all', parseRich('').length === 0 && parseRich(null).length === 0)
ok('A14', 'a note with no marks in it knows it is plain',
  isPlain('Reels, stories, shoots') === true && isPlain('- a') === false)
// Every span the renderer will be handed must be a string: React escapes
// strings, and this is the line between "typed a tag" and "ran a tag".
ok('A15', 'every parsed span is a plain string',
  parseRich('**a**\n- b <i>c</i>\n2 * 3').flatMap((b) => (b.type === 'ul' ? b.items.flat() : b.spans))
    .every((s) => typeof s.t === 'string'))

console.log('\n=== B. a list has to fit ===')
const board = (await req('/boards', 'POST', { name: `Struct ${Date.now().toString(36)}` })).data
const duties = [
  '**Owns** the YouTube channel end to end',
  '- Plan the month, produce and publish every video',
  '- Answer comments within a day, pin the good ones',
  '- Thumbnails, titles and the description block',
  '**Metric** YouTube views, and videos published against the plan',
  'Reports monthly: views, videos out, best and worst video.',
].join('\n')
ok('B1', 'the duties written above are longer than the old one-line cap',
  duties.length > 160, `${duties.length} characters`)
const saved = (await req(`/boards/${board.id}`, 'PATCH', { data: {
  nodes: [{ id: 'n1', x: 100, y: 100, text: 'YouTube Manager', sub: duties, color: '#a32234', user_id: null }],
  edges: [] } })).data
ok('B2', 'and the board keeps every word of them',
  saved.nodes[0].sub === duties, `${saved.nodes[0].sub.length} of ${duties.length} characters survived`)
ok('B3', '…including after a reload, not just in the reply',
  (await req(`/boards/${board.id}`)).data.nodes[0].sub === duties)
// Still bounded, or one board could be made to carry a novel per card.
const huge = (await req(`/boards/${board.id}`, 'PATCH', { data: {
  nodes: [{ id: 'n1', x: 0, y: 0, text: 'x', sub: 'y'.repeat(5000), color: '#a32234', user_id: null }],
  edges: [] } })).data
ok('B4', 'but a card cannot be made to hold a novel',
  huge.nodes[0].sub.length === 1200, String(huge.nodes[0].sub.length))
const longTitle = (await req(`/boards/${board.id}`, 'PATCH', { data: {
  nodes: [{ id: 'n1', x: 0, y: 0, text: 'z'.repeat(400), sub: '', color: '#a32234', user_id: null }],
  edges: [] } })).data
ok('B5', '…and the title is still held to its own limit',
  longTitle.nodes[0].text.length === 120, String(longTitle.nodes[0].text.length))

console.log('\n=== C. the card draws it ===')
await req(`/boards/${board.id}`, 'PATCH', { data: {
  nodes: [
    { id: 'n1', x: 120, y: 120, text: 'YouTube Manager', sub: duties, color: '#a32234', user_id: null },
    { id: 'n2', x: 420, y: 400, text: 'Instagram (Uzbek)', sub: 'Instagram (Uzbek)', color: '#2a78d6', user_id: null },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2' }] } })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(B + '/login')
await page.fill('input[name="username"], input#username, input[type="text"]', 'admin')
await page.fill('input[type="password"]', 'admin123')
await page.click('button[type="submit"]')
await page.waitForTimeout(1200)
await page.goto(B + '/admin?tab=board')
await page.waitForSelector('.board-node', { timeout: 15000 })
await page.waitForTimeout(600)

const card = page.locator('.board-node', { hasText: 'YouTube Manager' })
ok('C1', 'the card is on the board', (await card.count()) === 1)
ok('C2', 'the duties are drawn as a real list', (await card.locator('.bn-rich li').count()) === 3,
  String(await card.locator('.bn-rich li').count()))
ok('C3', '…and the words meant to stand out are bold',
  (await card.locator('.bn-rich b').count()) === 2, String(await card.locator('.bn-rich b').count()))
ok('C4', 'the asterisks themselves are nowhere on the card',
  !(await card.locator('.bn-rich').textContent()).includes('**'),
  await card.locator('.bn-rich').textContent())
ok('C5', 'a one-line note is still just a line',
  (await page.locator('.board-node', { hasText: 'Instagram (Uzbek)' }).locator('.bn-rich li').count()) === 0)

// The bug in the screenshot: the tools sat on top of the title.
await card.hover()
await page.waitForTimeout(250)
const clash = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.board-node')].find((e) => /YouTube Manager/.test(e.textContent))
  const t = n.querySelector('.bn-title').getBoundingClientRect()
  const tools = n.querySelector('.bn-tools').getBoundingClientRect()
  // The title's TEXT must end before the tools begin. Measured off a range so
  // the answer is where the letters are, not where the box is.
  const r = document.createRange()
  r.selectNodeContents(n.querySelector('.bn-title'))
  const text = r.getBoundingClientRect()
  return { textRight: Math.round(text.right), toolsLeft: Math.round(tools.left), titleTop: Math.round(t.top) }
})
ok('C6', 'hovering does not put the buttons on top of the role name',
  clash.textRight <= clash.toolsLeft + 1, JSON.stringify(clash))

// The connector leaves the BOTTOM of a card that is taller than the old
// fixed 76px, not the middle of its text.
const anchor = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.board-node')].find((e) => /YouTube Manager/.test(e.textContent))
  const box = n.getBoundingClientRect()
  const canvas = document.querySelector('.board-canvas').getBoundingClientRect()
  const d = document.querySelector('.board-edge path').getAttribute('d')
  const y1 = Number(/^M [\d.]+ ([\d.]+)/.exec(d)[1])
  return { cardHeight: Math.round(box.height), y1, top: 120 }
})
ok('C7', 'the card is taller than an empty one now that it says something',
  anchor.cardHeight > 76, `${anchor.cardHeight}px`)
ok('C8', 'and the line leaves its real bottom edge, not a number from before',
  Math.abs(anchor.y1 - (anchor.top + anchor.cardHeight)) <= 3,
  JSON.stringify(anchor))

console.log('\n=== D. quick to move around in ===')
// ORDER MATTERS HERE, and not for the app's sake. Panning first scrolls the
// card off the left edge of the canvas, and a press aimed at a card that is
// not on screen lands on the page behind it — which reads exactly like a
// broken drag and is not one. So: move the card while everything is where it
// was drawn, then pan.
await page.evaluate(() => { const c = document.querySelector('.board-canvas'); c.scrollLeft = 0; c.scrollTop = 0 })
await page.waitForTimeout(200)
const was = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.board-node')].find((e) => /YouTube Manager/.test(e.textContent))
  return { x: n.style.left, scroll: document.querySelector('.board-canvas').scrollLeft }
})
const cb = await card.boundingBox()
const canvasBox = await page.evaluate(() => {
  const r = document.querySelector('.board-canvas').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
ok('D0', 'the card under test is actually on screen to be pressed',
  cb.x >= canvasBox.x && cb.y >= canvasBox.y && cb.x + 80 <= canvasBox.x + canvasBox.w,
  JSON.stringify({ card: Math.round(cb.x), canvas: Math.round(canvasBox.x) }))
// Pressed on the title, near the top: a card with a list on it is taller than
// the canvas is deep, so its lower half can be clipped out of view.
await page.mouse.move(cb.x + 60, cb.y + 20)
await page.mouse.down()
await page.mouse.move(cb.x + 160, cb.y + 90, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
const now = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.board-node')].find((e) => /YouTube Manager/.test(e.textContent))
  return { x: n.style.left, scroll: document.querySelector('.board-canvas').scrollLeft }
})
ok('D1', 'dragging a card moves the card', now.x !== was.x, `${was.x} → ${now.x}`)
ok('D2', '…and leaves the field where it was', now.scroll === was.scroll, `${was.scroll} vs ${now.scroll}`)
// A FLICK: pressed, moved and released inside a single frame. Drag positions
// are collapsed to one state change per frame, so the newest position is
// often still waiting for a frame that never comes — and for a while the
// release cancelled that frame and the card sprang back to where it started.
//
// Driving the mouse through the debugging protocol CANNOT produce this: each
// instruction is its own round trip and a frame always slips in between, so
// the bug passes that test whether it is there or not (it did). The three
// events are dispatched by hand, in one synchronous run of script, which is
// the only way to be sure no frame separates them.
const flicked = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.board-node')].find((e) => /YouTube Manager/.test(e.textContent))
  const b = n.getBoundingClientRect()
  const at = (type, x, y) => n.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y,
  }))
  const fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y,
  }))
  const x0 = b.left + 60
  const y0 = b.top + 20
  at('pointerdown', x0, y0)
  fire('pointermove', x0 + 70, y0 + 40)
  fire('pointerup', x0 + 70, y0 + 40)
  return n.style.left
})
await page.waitForTimeout(300)
const landed = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.board-node')].find((e) => /YouTube Manager/.test(e.textContent))
  return n.style.left
})
ok('D3', 'a flick lands where it was let go, not back where it started',
  landed !== now.x, `${now.x} → ${landed} (mid-flick ${flicked})`)

// And now the field itself.
const before = await page.evaluate(() => document.querySelector('.board-canvas').scrollLeft)
await page.mouse.move(900, 700)
await page.mouse.down()
await page.mouse.move(700, 700, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const after = await page.evaluate(() => document.querySelector('.board-canvas').scrollLeft)
ok('D4', 'dragging the empty field moves the field', after > before, `${before} → ${after}`)
ok('D5', '…and the pan let go of the field when the button did',
  !(await page.locator('.board-canvas').getAttribute('class')).includes('panning'))
ok('D6', 'nothing on the page threw', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log('\n=== E. the editor writes the marks for you ===')
await page.locator('.board-node', { hasText: 'Instagram (Uzbek)' }).locator('.bn-title').click()
await page.waitForSelector('.rn-area', { timeout: 8000 })
await page.fill('.rn-area', 'plan\nshoot')
await page.evaluate(() => {
  const a = document.querySelector('.rn-area')
  a.focus(); a.setSelectionRange(0, a.value.length)
})
await page.locator('.rn-btn[aria-label="Bullet list"]').click()
await page.waitForTimeout(150)
let box = await page.inputValue('.rn-area')
ok('E1', 'the bullet button bullets every line that was picked',
  box === '- plan\n- shoot', JSON.stringify(box))
await page.evaluate(() => {
  const a = document.querySelector('.rn-area')
  a.focus(); a.setSelectionRange(0, a.value.length)
})
await page.locator('.rn-btn[aria-label="Bullet list"]').click()
await page.waitForTimeout(150)
box = await page.inputValue('.rn-area')
ok('E2', '…and pressing it again takes them off', box === 'plan\nshoot', JSON.stringify(box))
await page.evaluate(() => {
  const a = document.querySelector('.rn-area')
  a.focus(); a.setSelectionRange(0, 4)
})
await page.locator('.rn-btn[aria-label="Bold"]').click()
await page.waitForTimeout(150)
box = await page.inputValue('.rn-area')
ok('E3', 'the bold button wraps what was picked', box === '**plan**\nshoot', JSON.stringify(box))
ok('E4', 'the preview shows what the card will say',
  (await page.locator('.rn-preview .bn-rich b').count()) === 1,
  String(await page.locator('.rn-preview .bn-rich b').count()))
// Enter carries a list on — the reason a list is quick to type at all.
await page.fill('.rn-area', '- plan')
await page.evaluate(() => {
  const a = document.querySelector('.rn-area')
  a.focus(); a.setSelectionRange(a.value.length, a.value.length)
})
await page.keyboard.press('Enter')
await page.keyboard.type('shoot')
await page.waitForTimeout(150)
box = await page.inputValue('.rn-area')
ok('E5', 'Enter inside a list starts the next bullet',
  box === '- plan\n- shoot', JSON.stringify(box))
await page.keyboard.press('Enter')
await page.keyboard.press('Enter')
await page.waitForTimeout(150)
box = await page.inputValue('.rn-area')
ok('E6', '…and Enter on an empty one ends the list instead of going for ever',
  !box.endsWith('- '), JSON.stringify(box))
ok('E7', 'still nothing threw', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n${'='.repeat(58)}`)
if (found.length) {
  console.log(`${found.length} FINDING(S):`)
  found.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
} else {
  console.log('Board suite clean.')
}
process.exit(fails ? 1 : 0)
