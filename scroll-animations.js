// Scroll-triggered entry animations using IntersectionObserver + GSAP.
// Handles resize natively — no teardown/rebuild needed.
import gsap from 'gsap'

let observer = null

export function startObserving() {
  if (observer) return

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target
      if (entry.isIntersecting) {
        const comingFromBelow = entry.boundingClientRect.top > 0
        const duration = !el.__observed ? 0 : comingFromBelow ? 0.6 : 0
        gsap.to(el, { y: 0, opacity: 1, duration, ease: 'power2.out' })
      } else if (el.__observed) {
        const leftBelow = entry.boundingClientRect.top > entry.rootBounds.bottom
        if (leftBelow) {
          gsap.to(el, { y: 24, opacity: 0, duration: 0.4, ease: 'power2.in' })
        }
      }
    })
  }, { rootMargin: '0px 0px -15% 0px' })

  document.querySelectorAll('.animate-in').forEach(el => {
    gsap.set(el, { y: 24, opacity: 0 })
    el.__observed = false
    observer.observe(el)
    requestAnimationFrame(() => { el.__observed = true })
  })
}

export function setupScrollAnimations() {
  document.getElementById('content')?.classList.remove('preview')
  // Observer may already be running from the portal preview phase.
  // If not (e.g. skip was clicked before portal window opened), start it now.
  startObserving()
}
