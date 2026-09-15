import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ContentModal from './ContentModal.jsx'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- giving a task, from wherever you are ----
// On a desk the button lives on the channel board, which is fine: you were
// already looking at the board. On a phone that meant three taps through a
// drawer before you could write down the thing you had just been told, and by
// then you were doing something else.
//
// The raised button in the tab bar opens this. It is the same form the board
// opens — the same required fields, the same refusals, the same stage rules —
// mounted from the shell instead, with the channel filled in from the page you
// were on. Once it is saved you land on that channel's board, where the task
// now is.
export default function NewTask({ onClose }) {
  const [statuses, setStatuses] = useState(null)
  const nav = useNavigate()
  const { pathname } = useLocation()
  // /dept/<key> — the channel you were looking at is the channel you meant.
  const here = pathname.startsWith('/dept/') ? pathname.split('/')[2] : ''

  useEffect(() => {
    let live = true
    api.get('/statuses')
      .then((s) => { if (live) setStatuses(s) })
      .catch(() => {
        if (!live) return
        toast(tx('Could not open the form — check the connection'), 'err')
        onClose()
      })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Nothing is drawn until the stages are known: a form whose stage chips
  // arrive a moment later is a form you can start filling in wrong.
  if (!statuses) return null

  return (
    <ContentModal
      item={null}
      statuses={statuses}
      defaults={here ? { channels: [here] } : {}}
      onClose={onClose}
      onCreate={async (payload) => {
        const c = await api.post('/content', payload)
        const to = c?.channels?.[0] || payload.channels?.[0]
        // The board polls for new work every few seconds, so landing on it is
        // enough — the task is there by the time the page has painted.
        if (to && `/dept/${to}` !== pathname) nav(`/dept/${to}`)
        return c
      }}
    />
  )
}
