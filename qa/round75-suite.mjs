// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 75: reading somebody else's ТЗ.
//
// A shooter who reads Uzbek gets a script written in Russian and films
// roughly the right courtyard. The board has always been strict about whether
// a script EXISTS and has never once cared whether the person holding it can
// read it. Two buttons: translate it, or say it in plainer words.
//
// WHAT IS ACTUALLY TESTED HERE. Not the providers — two want money, three
// want an account, and the free pair are somebody else's unofficial endpoint
// that may be up or down on the day. What is ours is the cascade: the order
// they are tried in, that a dead provider costs one move and not the feature,
// that the answer is kept so the same brief is not paid for twice, that a
// long script is cut up and comes back whole, and — the one that matters —
// that when NOTHING is reachable the board says so plainly instead of
// pretending a regular expression is an AI.
//
// Self-contained: port 4114 + mock 9975.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const B = 'http://localhost:4114/api'
const MOCK = 'http://localhost:9975'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-ai.mjs'], { MOCK_AI_PORT: '9975' })
// Every provider pointed at the mock, and every key set so each is "configured".
boot([ROOT + '/server/index.js'], {
  DATA_DIR: SP + 'r75-' + Date.now(), PORT: '4114',
  ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'k', GROQ_API_KEY: 'k', OPENROUTER_API_KEY: 'k',
  ANTHROPIC_BASE_URL: MOCK, OPENAI_BASE_URL: MOCK + '/openai/v1', GEMINI_BASE_URL: MOCK + '/v1beta',
  GROQ_BASE_URL: MOCK + '/groq/v1', OPENROUTER_BASE_URL: MOCK + '/openrouter/v1',
  GOOGLE_TRANSLATE_BASE: MOCK, MYMEMORY_BASE: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('the mock and the stack are up', (await up(MOCK + '/__calls')) && (await up(B + '/health')))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const breakThese = (who) => fetch(`${MOCK}/__fail?who=${who}`, { method: 'POST' })
const calls = async () => (await (await fetch(MOCK + '/__calls')).json())

const RU = 'Снимаем интро во дворе на закате, потом крупный план сертификата. Правки пришли на почту.'
const EN = 'Shoot the intro in the courtyard at golden hour, then a close-up of the certificate.'
const UZ = 'Introni hovlida kun botishida suratga olamiz va sertifikatning yaqin planini qilamiz.'

// ===================== what language is this =====================
const detect = async (text) => (await req('/ai/detect', 'POST', { text })).data.lang
ok('Russian is read as Russian', (await detect(RU)) === 'ru')
ok('English is read as English', (await detect(EN)) === 'en')
ok('Uzbek is not mistaken for English', (await detect(UZ)) === 'uz')
ok('an empty brief has no language to offer', (await detect('   ')) === null)
ok('a bare link is not a language', (await detect('https://drive.google.com/x')) === null,
  String(await detect('https://drive.google.com/x')))

// The task window works the language out itself rather than asking — opening
// a task would otherwise cost two round trips, one for the script and one for
// the description, on the screen this board opens more than any other. Two
// copies of a rule is two chances to disagree, so they are checked against
// each other on the awkward cases.
const { guessLang: clientGuess } = await import(ROOT + '/client/src/lib/text.js')
const { guessLang: serverGuess } = await import(ROOT + '/server/ai.js')
const CASES = [RU, EN, UZ, '', '   ', 'https://drive.google.com/x', '@dilnoza', 'ok',
  'Reel https://x.com/a @bob 14:30', 'Правки 14:30', 'Shoot at 14:30 in the courtyard']
const disagree = CASES.filter((c) => clientGuess(c) !== serverGuess(c))
ok('the client reads a language exactly as the server does', disagree.length === 0,
  JSON.stringify(disagree.map((c) => [c.slice(0, 24), clientGuess(c), serverGuess(c)])))

// ===================== the cascade =====================
await reset()
let r = await req('/ai/translate', 'POST', { text: RU, to: 'en' })
ok('a translation comes back', r.status === 200 && !!r.data.text, JSON.stringify(r.data).slice(0, 120))
ok('…from the best provider available', r.data.provider === 'anthropic', String(r.data.provider))
ok('…and it is the text that was sent, not a summary of it',
  r.data.text.includes(RU), r.data.text.slice(0, 80))
ok('exactly one provider was called', (await calls()).length === 1, JSON.stringify((await calls()).map((c) => c.who)))

// The first one dies. The feature does not.
await reset(); await breakThese('anthropic')
r = await req('/ai/translate', 'POST', { text: RU + ' 2', to: 'en' })
ok('a dead provider costs one move, not the feature', r.data.provider === 'openai', String(r.data.provider))
ok('…and the dead one really was tried first',
  (await calls()).every((c) => c.who !== 'anthropic'), JSON.stringify((await calls()).map((c) => c.who)))

// All the models die. The free services are still there — that is the whole
// point of "if there are no credits, use the best free thing".
await reset(); await breakThese('anthropic,openai,gemini,groq,openrouter')
r = await req('/ai/translate', 'POST', { text: RU + ' 3', to: 'en' })
ok('with every model down, a free service does it', r.data.provider === 'google', String(r.data.provider))
ok('…and it is marked as the free path', r.data.free === true, JSON.stringify(r.data.free))

// The first free one dies too.
await reset(); await breakThese('anthropic,openai,gemini,groq,openrouter,google')
r = await req('/ai/translate', 'POST', { text: RU + ' 4', to: 'en' })
ok('the second free service catches it', r.data.provider === 'mymemory', String(r.data.provider))

// Everything is down. Say so — and say the original is still there.
await reset(); await breakThese('anthropic,openai,gemini,groq,openrouter,google,mymemory')
r = await req('/ai/translate', 'POST', { text: RU + ' 5', to: 'en' })
ok('with nothing reachable it refuses honestly', r.status === 503, String(r.status))
ok('…and says the original is still there', /original/i.test(r.data.error || ''), r.data.error)
ok('…and lists what it tried, so this is debuggable', (r.data.tried || []).length === 7,
  JSON.stringify((r.data.tried || []).length))

// ===================== paid for once, read many times =====================
await reset(); await breakThese('')
const SHARED = 'Снимаем во дворе. Один и тот же бриф читают трое.'
const first = await req('/ai/translate', 'POST', { text: SHARED, to: 'en' })
const nCalls = (await calls()).length
const second = await req('/ai/translate', 'POST', { text: SHARED, to: 'en' })
ok('the same brief is not translated twice', (await calls()).length === nCalls,
  `${nCalls} then ${(await calls()).length}`)
ok('…the second reader gets the same words', second.data.text === first.data.text)
ok('…and is told it was kept', second.data.cached === true, String(second.data.cached))
ok('a different language is a different question',
  (await req('/ai/translate', 'POST', { text: SHARED, to: 'uz' })).data.cached !== true)
// An edited brief must not serve the old translation — that is how somebody
// films last week's script.
ok('an edited brief is translated again',
  (await req('/ai/translate', 'POST', { text: SHARED + ' Плюс ещё одна сцена.', to: 'en' })).data.cached !== true)

// ===================== a long script comes back whole =====================
await reset(); await breakThese('anthropic,openai,gemini,groq,openrouter')
const LONG = Array.from({ length: 30 }, (_, i) => `Сцена ${i + 1}. Снимаем план номер ${i + 1} во дворе университета.`).join('\n\n')
r = await req('/ai/translate', 'POST', { text: LONG, to: 'en' })
ok('a long script goes over in pieces', (await calls()).length > 1, String((await calls()).length))
ok('…and comes back as one document', r.status === 200 && r.data.text.length > LONG.length * 0.5,
  `${r.data.text.length} vs ${LONG.length}`)
ok('…with every scene still in it',
  [1, 15, 30].every((n) => r.data.text.includes(`Сцена ${n}.`)), r.data.text.slice(0, 60))
ok('…in the order they were written',
  r.data.text.indexOf('Сцена 1.') < r.data.text.indexOf('Сцена 30.'))

// ===================== explain it simply =====================
await reset(); await breakThese('')
r = await req('/ai/simplify', 'POST', { text: RU, lang: 'ru' })
ok('a model rewrites the brief when there is one', r.data.provider === 'anthropic', String(r.data.provider))

// And when there is no model at all — which is every board that has not paid
// for one — it must NOT claim to have reworded anything.
await reset(); await breakThese('anthropic,openai,gemini,groq,openrouter')
r = await req('/ai/simplify', 'POST', {
  text: 'Снимаем интро; отправь правки и ТЗ на https://drive.google.com/x до 14:30, пингани @dilnoza',
  lang: 'ru',
})
ok('with no model it still gives something useful', r.status === 200 && !!r.data.text)
ok('…and calls it what it is, not AI', r.data.provider === 'plain', String(r.data.provider))
ok('…one instruction per line', /1\. /.test(r.data.text) && /2\. /.test(r.data.text), r.data.text.slice(0, 60))
ok('…the team’s shorthand spelled out', /ТЗ \(техзадание\)/.test(r.data.text), r.data.text)
ok('…and the things that cost money to miss, lifted out',
  /Не пропустить/.test(r.data.text) && r.data.text.includes('14:30')
  && r.data.text.includes('@dilnoza') && r.data.text.includes('https://drive.google.com/x'), r.data.text)
ok('…inventing no word that was not there',
  ['интро', 'правки', 'ТЗ', 'dilnoza'].every((w) => r.data.text.includes(w)))

// ===================== the guard rails =====================
await breakThese('')
ok('an empty brief is refused rather than billed',
  (await req('/ai/translate', 'POST', { text: '   ', to: 'en' })).status === 400)
ok('a made-up language is refused',
  (await req('/ai/translate', 'POST', { text: EN, to: 'klingon' })).status === 400)
ok('something longer than any real script is refused',
  (await req('/ai/translate', 'POST', { text: 'x'.repeat(20001), to: 'en' })).status === 413)
ok('a stranger cannot use the board’s credits',
  (await (await fetch(B + '/ai/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: EN, to: 'ru' }) })).status) === 401)

// The crew may translate — they are the ones who cannot read the brief.
const ch = (await req('/channels')).data[0].key
await req('/users', 'POST', { name: 'R75 Shooter', username: 'r75op', password: 'probe123', role: 'operator', departments: [ch] })
const opT = await login('r75op', 'probe123')
ok('the crew can read a brief in their own language',
  (await req('/ai/translate', 'POST', { text: RU, to: 'uz' }, opT)).status === 200)
ok('…but cannot see what the board is paying for',
  (await req('/ai/status', 'GET', null, opT)).status === 403)

// ===================== what the admin can see =====================
const st = (await req('/ai/status')).data
ok('the admin is told which models are configured', Array.isArray(st.models) && st.models.length === 5,
  JSON.stringify(st.models))
ok('…and that the free path exists either way', st.free.length === 2, JSON.stringify(st.free))
ok('…and how much has been kept', typeof st.cached === 'number' && st.cached > 0, String(st.cached))
const pr = (await req('/ai/probe', 'POST', {})).data
ok('probing really calls every one of them', pr.results.length === 7, String(pr.results?.length))
ok('…and reports each as reachable or not', pr.results.every((x) => 'ok' in x))
ok('clearing the kept translations works',
  (await req('/ai/cache', 'DELETE')).status === 200 && (await req('/ai/status')).data.cached === 0)

stop()
console.log(fails === 0 ? '\nRound-75 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)
