import { initials } from '../lib/constants.js'

// Team avatar: the profile photo when one is set, initials on the accent
// color otherwise.
export default function Avatar({ name, color = '#a32234', size = 'md', src = null }) {
  const cls = size === 'xs' ? 'avatar avatar-xs' : size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar'
  if (src) {
    return <img className={`${cls} avatar-img`} src={src} alt={name} title={name} />
  }
  return (
    <div className={cls} style={{ background: color }} title={name}>
      {initials(name)}
    </div>
  )
}
