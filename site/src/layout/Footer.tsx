export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p className="site-footer__brand">
          Medically <em>Complicated</em>
        </p>
        <p className="site-footer__tagline">
          Reliable medical information and lived experience, together in one place.
        </p>
        <p className="site-footer__legal">
          <span>© {year} Medically Complicated</span>
          <span className="site-footer__sep" aria-hidden="true">
            ·
          </span>
          <span>This site does not replace professional medical advice.</span>
        </p>
      </div>
    </footer>
  )
}
