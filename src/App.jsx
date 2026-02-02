import { useState } from 'react'
import Dashboard from './pages/Dashboard.jsx'
import Home from './pages/Home.jsx'

function App() {
  const [page, setPage] = useState('home')

  if (page === 'dashboard') {
    return <Dashboard onNavigateHome={() => setPage('home')} />
  }

  return <Home onSignIn={() => setPage('dashboard')} />
}

export default App
