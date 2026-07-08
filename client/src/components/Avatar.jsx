import { initials } from '../lib/constants.js'

export default function Avatar({ name, color = '#a32234', size = 'md' }) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar'
  return (
    <div className={cls} style={{ background: color }} title={name}>
      {initials(name)}
    </div>
  )
}
