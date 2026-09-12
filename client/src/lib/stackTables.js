// ---- a table is not a shape a phone has ----
// Eleven tables in this app, six columns wide, on a 390px screen. Side-scroll
// makes them technically reachable and practically unreadable: you see two
// columns and have to remember what the other four said.
//
// Stacked, each row becomes a card and each cell a labelled line — which is
// what every phone app does with a table. The labels come from the table's own
// header, copied onto the cells at runtime, so no table had to be rewritten
// and a new one gets the same treatment for free.
export function stampTables(root = document) {
  for (const table of root.querySelectorAll('table.tbl')) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim())
    if (!heads.length) continue
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.children]
      // A row that spans the whole table (an empty state, a detail panel) has
      // no column to be labelled by, and labelling it would be a lie.
      if (cells.length !== heads.length) continue
      cells.forEach((td, i) => {
        const label = heads[i] || ''
        if (td.dataset.th !== label) td.dataset.th = label
      })
    }
  }
}

// Stamps once, then again whenever the page grows a table — a tab switch, a
// row added, a list arriving from the network. Attribute changes are not
// watched, so writing the labels cannot wake the observer that wrote them.
export function watchTables() {
  let queued = false
  const run = () => {
    queued = false
    stampTables()
  }
  run()
  const mo = new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(run)
  })
  mo.observe(document.body, { childList: true, subtree: true })
  return () => mo.disconnect()
}
