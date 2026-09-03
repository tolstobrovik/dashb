import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { usePages } from './lib/pages.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'

// Pages load on demand: the first paint (login / app shell) ships only what
// it needs, and each section's code arrives when it is first opened.
const Department = lazy(() => import('./pages/Department.jsx'))
const Overview = lazy(() => import('./pages/Overview.jsx'))
const Projects = lazy(() => import('./pages/Projects.jsx'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'))
const CampaignDetail = lazy(() => import('./pages/CampaignDetail.jsx'))
const Brief = lazy(() => import('./pages/Brief.jsx'))
const Missed = lazy(() => import('./pages/Missed.jsx'))
const Schedule = lazy(() => import('./pages/Schedule.jsx'))
const Crew = lazy(() => import('./pages/Crew.jsx'))
const Team = lazy(() => import('./pages/Team.jsx'))
const Docs = lazy(() => import('./pages/Docs.jsx'))
const Design = lazy(() => import('./pages/Design.jsx'))
const Sprints = lazy(() => import('./pages/Sprints.jsx'))
const SprintBacklog = lazy(() => import('./pages/SprintBacklog.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const Ambassadors = lazy(() => import('./pages/Ambassadors.jsx'))

const Loading = () => <div className="app-loading"><span className="spinner" /></div>

function Protected({ children, adminOnly = false, page = null, ambassador = false }) {
  const { user, loading } = useAuth()
  const { shows } = usePages()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  // An ambassador has one address. The server refuses everything else outright
  // — this only stops the browser drawing a page it is about to be refused the
  // data for, and sends them back to the page that is theirs.
  //
  // The check has to let their OWN address through, because the shell they
  // reach it in is wrapped in this same guard: bouncing every path to
  // /ambassador bounced /ambassador too, and the page never drew at all.
  if (user.role === 'ambassador' && !ambassador && location.pathname !== '/ambassador')
    return <Navigate to="/ambassador" replace />
  if (ambassador && user.role !== 'ambassador' && user.role !== 'admin') return <Navigate to="/" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />
  // A page the admin switched off has no address either. Its own door is gone
  // from the sidebar, so what this catches is a bookmark, a pasted link and a
  // browser's back button — all of which would otherwise land on a page the
  // team has been told they do not have.
  if (page && !shows(page)) return <Navigate to="/" replace />
  return children
}

// Admins land on the all-departments overview; members on their daily brief —
// what to record and edit today comes before any metrics.
function HomeRedirect() {
  const { user } = useAuth()
  if (user?.role === 'ambassador') return <Navigate to="/ambassador" replace />
  if (user?.role === 'admin') return <Navigate to="/overview" replace />
  return <Navigate to="/brief" replace />
}

export default function App() {
  const { user } = useAuth()
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/overview"
            element={
              <Protected adminOnly page="overview">
                <Overview />
              </Protected>
            }
          />
          <Route path="/projects" element={<Protected page="projects"><Projects /></Protected>} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/dept/:key" element={<Department />} />
          <Route path="/brief" element={<Brief />} />
          <Route path="/releases" element={<Protected page="releases"><Schedule mode="release" /></Protected>} />
          <Route path="/recordings" element={<Protected page="recordings"><Schedule mode="recording" /></Protected>} />
          <Route path="/missed" element={<Protected page="missed"><Missed /></Protected>} />
          <Route
            path="/crew"
            element={
              <Protected adminOnly page="crew">
                <Crew />
              </Protected>
            }
          />
          <Route
            path="/team"
            element={
              <Protected adminOnly page="team">
                <Team />
              </Protected>
            }
          />
          {/* The designer's own board — every piece waiting on artwork, with
              its Drive folder, its brief and somewhere to hand the file back. */}
          <Route path="/design" element={<Protected page="design"><Design /></Protected>} />
          <Route path="/docs" element={<Protected page="docs"><Docs /></Protected>} />
          <Route path="/sprints" element={<Protected page="sprints"><Sprints /></Protected>} />
          <Route path="/sprints/backlog" element={<Protected page="sprints"><SprintBacklog /></Protected>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/ambassador" element={<Protected ambassador><Ambassadors /></Protected>} />
          <Route
            path="/admin"
            element={
              <Protected adminOnly>
                <Admin />
              </Protected>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
