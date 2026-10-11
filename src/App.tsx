import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { configured, supabase } from './lib/supabase'
import AuthPage from './pages/AuthPage'
import Dashboard from './pages/Dashboard'
import Applications from './pages/Applications'
import Radar from './pages/Radar'
import SkillMap from './pages/SkillMap'
import Reminders from './pages/Reminders'
import Profile from './pages/Profile'
import ApplicationDetail from './pages/ApplicationDetail'
function Shell() {
  const { session, loading, error, retry } = useAuth()
  if (!configured) return <main className="center"><div className="card"><h1>Setup required</h1><p>Copy <code>.env.example</code> to <code>.env</code> and add your Supabase URL and anon key, then restart. See README.md.</p></div></main>
  if (loading) return <main className="center" role="status">Loading…</main>
  if (error) return <main className="center"><div className="card" role="alert"><p className="err">{error}</p><button onClick={retry}>Try again</button></div></main>
  if (!session) return <Navigate to="/login" replace />
  return <div className="shell">
    <nav className="side" aria-label="Main"><strong className="brand">ApplySignal AI</strong>
      {[['/', 'Dashboard'], ['/radar', 'Opportunity Radar'], ['/applications', 'Applications'], ['/reminders', 'Reminders'], ['/skillmap', 'SkillMap'], ['/profile', 'Profile']].map(([to, l]) => <NavLink key={to} to={to} end={to === '/'}>{l}</NavLink>)}
      <div className="grow" /><small className="muted">{session.user.email}</small>
      <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></nav>
    <main className="main"><Outlet /></main></div>
}
export default function App() {
  return <Routes>
    <Route path="/login" element={<AuthPage mode="login" />} /><Route path="/signup" element={<AuthPage mode="signup" />} />
    <Route path="/forgot" element={<AuthPage mode="forgot" />} /><Route path="/reset" element={<AuthPage mode="reset" />} />
    <Route element={<Shell />}><Route index element={<Dashboard />} /><Route path="radar" element={<Radar />} /><Route path="applications" element={<Applications />} /><Route path="applications/:id" element={<ApplicationDetail />} /><Route path="skillmap" element={<SkillMap />} /><Route path="reminders" element={<Reminders />} /><Route path="profile" element={<Profile />} /></Route>
    <Route path="*" element={<main className="center"><div className="card"><h1>Page not found</h1><NavLink to="/">Back to dashboard</NavLink></div></main>} />
  </Routes>
}
