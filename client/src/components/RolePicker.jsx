// One role picker for everywhere a person's role is set (Admin → People and
// Team & hiring). Three account kinds — member, production crew, admin — and
// for crew the capabilities MULTI-SELECT: editor, operator, designer, in any
// mix. onChange always reports a normalized (role, crew_roles) pair; the
// server applies the same normalization, so both stay in agreement.
export const CREW_CAPS = [
  { key: 'editor', label: 'Editor', desc: 'edits videos' },
  { key: 'operator', label: 'Operator', desc: 'films videos' },
  { key: 'designer', label: 'Designer', desc: 'designs posts & artwork' },
]

export const kindOf = (role) => (role === 'admin' ? 'admin' : role === 'member' ? 'member' : 'crew')

export default function RolePicker({ role, crewRoles, onChange }) {
  const kind = kindOf(role)
  const caps = crewRoles?.length ? crewRoles : kind === 'crew' ? ['editor'] : []
  const emit = (nextCaps) =>
    onChange(nextCaps.length === 1 ? nextCaps[0] : 'crew', CREW_CAPS.map((c) => c.key).filter((k) => nextCaps.includes(k)))
  const setKind = (k) => {
    if (k === 'crew') emit(caps.length ? caps : ['editor'])
    else onChange(k, [])
  }
  const toggleCap = (c) => {
    const next = caps.includes(c) ? caps.filter((x) => x !== c) : [...caps, c]
    if (next.length === 0) return // a crew account holds at least one capability
    emit(next)
  }
  return (
    <>
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="member">Member — runs channels</option>
        <option value="crew">Production crew — films, edits or designs</option>
        <option value="admin">Admin</option>
      </select>
      {kind === 'crew' && (
        <div className="checkbox-row" style={{ marginTop: 8 }}>
          {CREW_CAPS.map((c) => (
            <label key={c.key} className={'checkbox-chip' + (caps.includes(c.key) ? ' on' : '')}>
              <input type="checkbox" checked={caps.includes(c.key)} onChange={() => toggleCap(c.key)} />
              {c.label} — {c.desc}
            </label>
          ))}
        </div>
      )}
    </>
  )
}
