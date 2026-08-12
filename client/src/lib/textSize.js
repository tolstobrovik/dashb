// Site-wide text size — Small / Medium / Large, remembered per device.
// `zoom` scales everything (text, spacing, cards) and reflows properly,
// unlike transform: scale; every current browser supports it.
const KEY = 'satashkent_text_size'

export const TEXT_SIZES = [
  { key: 'small', label: 'Small', zoom: 0.88 },
  { key: 'medium', label: 'Medium', zoom: 1 },
  { key: 'large', label: 'Large', zoom: 1.14 },
]

export function getTextSize() {
  const k = localStorage.getItem(KEY)
  return TEXT_SIZES.some((s) => s.key === k) ? k : 'medium'
}

export function applyTextSize(key = getTextSize()) {
  const s = TEXT_SIZES.find((x) => x.key === key) || TEXT_SIZES[1]
  document.documentElement.style.zoom = s.zoom === 1 ? '' : String(s.zoom)
  localStorage.setItem(KEY, s.key)
}
