import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'

import LandingPage     from './pages/LandingPage'
import DashboardPage   from './pages/DashboardPage'
import VideosPage      from './pages/VideosPage'
import VideoDetailPage from './pages/VideoDetailPage'
import RepliesPage     from './pages/RepliesPage'
import PersonasPage    from './pages/PersonasPage'
import AppLayout       from './layouts/AppLayout'
import ProtectedRoute  from './components/ProtectedRoute'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />

        {/* Authenticated — guarded by ProtectedRoute, shared layout */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard"       element={<DashboardPage />} />
          <Route path="/videos"          element={<VideosPage />} />
          <Route path="/videos/:videoId" element={<VideoDetailPage />} />
          <Route path="/replies"         element={<RepliesPage />} />
          <Route path="/personas"        element={<PersonasPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
