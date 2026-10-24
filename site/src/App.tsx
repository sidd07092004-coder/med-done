import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { DocumentLang } from './layout/DocumentLang'
import { Footer } from './layout/Footer'
import { Header } from './layout/Header'
import { NavProvider } from './layout/NavContext'
import { ContentPage } from './pages/ContentPage'
import { HomePage } from './pages/HomePage'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollToTop />
      <DocumentLang />
      <NavProvider>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Header />
        <Routes>
          <Route path="/" element={<HomePage />} />
          {/* Catch-all: the URL path (minus slashes) is the page slug, which
              preserves nested slugs such as /bt/diagnosis. */}
          <Route path="/*" element={<ContentPage />} />
        </Routes>
        <Footer />
      </NavProvider>
    </BrowserRouter>
  )
}
