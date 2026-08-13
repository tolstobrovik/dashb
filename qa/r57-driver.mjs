// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Drives the storage layer the way the SERVERLESS entry does: a write, then a
// flush, per "request" — several at once. The long-running server flushes on a
// timer instead, which is why this needs its own driver to be honest about
// what it proves.
// A computed path cannot be a static import specifier — this one is resolved
// at run time, which is the whole point of DASHB_ROOT.
const { initDb, run, flushPending } = await import(ROOT + '/server/db.js')

const N = Number(process.env.R57_N || 8)
await initDb()
await flushPending()                       // settle whatever boot wrote
const t0 = Date.now()
await Promise.all([...Array(N)].map(async (_, i) => {
  await run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    `r57-${i}`, `v${i}-${t0}`)
  await flushPending()                     // exactly what api/index.js awaits
}))
console.log('DRIVER-DONE')
process.exit(0)
