import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { useChannels } from './lib/channels.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Department from './pages/Department.jsx'
import Todo from './pages/Todo.jsx'
import Admin from './pages/Admin.jsx'

function Protected({ children, adminOnly = false }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="app-loading"><span className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

// Land on the first channel the user can see (or their to-do list).
function HomeRedirect() {
  const { visible, channels } = useChannels()
  if (channels.length === 0) return <div className="app-loading"><span className="spinner" /></div>
  const first = visible[0]
  return <Navigate to={first ? `/dept/${first.key}` : '/todo'} replace />
}

export default function App() {
  const { user } = useAuth()
  return (
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
        <Route path="/dept/:key" element={<Department />} />
        <Route path="/todo" element={<Todo />} />
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
  )
}
