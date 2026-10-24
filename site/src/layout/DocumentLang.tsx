import { useEffect } from 'react'
import { useLang } from '../hooks/useLang'

/**
 * Reflects the active site language on <html> so assistive technology and the
 * browser pick the right language and writing direction. Arabic is the only
 * right-to-left language supported by the public site today.
 */
export function DocumentLang() {
  const lang = useLang().toLowerCase()
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    const root = document.documentElement
    const previousLang = root.lang
    const previousDir = root.dir
    root.lang = lang
    root.dir = dir

    return () => {
      root.lang = previousLang
      root.dir = previousDir
    }
  }, [lang, dir])

  return null
}
