import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'

// Pages load on demand: the first paint (login / app shell) ships only what
// it needs, and each section's code arrives when it is first opened.
const Department = lazy(() => import('./pages/Department.jsx'))
const Overview = lazy(() => import('./pages/Overview.jsx'))
const Projects = lazy(() => import('./pages/Projects.jsx'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'))
const CampaignDetail = lazy(() => import('./pages/CampaignDetail.jsx'))
const Todo = lazy(() => import('./pages/Todo.jsx'))
const Brief = lazy(() => import('./pages/Brief.jsx'))
const Missed = lazy(() => import('./pages/Missed.jsx'))
const MissedTasks = lazy(() => import('./pages/MissedTasks.jsx'))
const Schedule = lazy(() => import('./pages/Schedule.jsx'))
const Unassigned = lazy(() => import('./pages/Unassigned.jsx'))
const Crew = lazy(() => import('./pages/Crew.jsx'))
const Team = lazy(() => import('./pages/Team.jsx'))
const Docs = lazy(() => import('./pages/Docs.jsx'))
const Sprints = lazy(() => import('./pages/Sprints.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))

const Loading = () => <div className="app-loading"><span className="spinner" /></div>

function Protected({ children, adminOnly = false }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

// Admins land on the all-departments overview; members on their daily brief —
// what to record and edit today comes before any metrics.
function HomeRedirect() {
  const { user } = useAuth()
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
              <Protected adminOnly>
                <Overview />
              </Protected>
            }
          />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/dept/:key" element={<Department />} />
          <Route path="/brief" element={<Brief />} />
          <Route path="/todo" element={<Todo />} />
          <Route path="/releases" element={<Schedule mode="release" />} />
          <Route path="/recordings" element={<Schedule mode="recording" />} />
          <Route path="/missed" element={<Missed />} />
          <Route path="/missed-tasks" element={<MissedTasks />} />
          <Route
            path="/unassigned"
            element={
              <Protected adminOnly>
                <Unassigned />
              </Protected>
            }
          />
          <Route
            path="/crew"
            element={
              <Protected adminOnly>
                <Crew />
              </Protected>
            }
          />
          <Route
            path="/team"
            element={
              <Protected adminOnly>
                <Team />
              </Protected>
            }
          />
          <Route path="/docs" element={<Docs />} />
          <Route path="/sprints" element={<Sprints />} />
          <Route path="/profile" element={<Profile />} />
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
