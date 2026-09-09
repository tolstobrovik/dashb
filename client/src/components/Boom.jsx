import { Component } from 'react'
import { RefreshCw, ArrowLeft } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// The app had no error boundary at all, so ONE bad render anywhere unmounted
// the whole root and left a white page — no message, no way back, and nothing
// in the console once the tab was reloaded. "It goes blank when I click that
// task" was unreportable and unreproducible by anybody but the person it
// happened to.
//
// Two of these are mounted: one around the routed page, so a page that throws
// leaves the shell — the sidebar, the bell, the way out — standing; and one
// around the whole app as the backstop. Neither swallows the fault: it is
// still thrown to the console, and the message and component stack are on
// screen, foldable, so a screenshot is a bug report.
export default class Boom extends Component {
  constructor(props) { super(props); this.state = { err: null, info: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) {
    this.setState({ info })
    console.error('Render failed:', err, info?.componentStack)
  }
  render() {
    const { err, info } = this.state
    if (!err) return this.props.children
    return (
      <div className="boom" role="alert">
        <b>{tx('This part of the page could not be drawn.')}</b>
        <span className="stat-sub">{tx('Nothing you did is lost — the board is still there.')}</span>
        <div className="boom-do">
          <button className="btn btn-primary" onClick={() => this.setState({ err: null, info: null })}>
            <RefreshCw size={15} /> {tx('Try again')}
          </button>
          <button className="btn" onClick={() => { window.location.href = '/brief' }}>
            <ArrowLeft size={15} /> {tx('Back to My Day')}
          </button>
        </div>
        <details className="boom-why">
          <summary className="stat-sub">{tx('What went wrong')}</summary>
          <pre>{String(err?.message || err)}{info?.componentStack ? `\n${info.componentStack}` : ''}</pre>
        </details>
      </div>
    )
  }
}
