// Scroll-triggered entry animations using IntersectionObserver + GSAP.
// Handles resize natively — no teardown/rebuild needed.

export function setupScrollAnimations() {
  document.getElementById('content')?.classList.remove('preview')

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target
      if (entry.isIntersecting) {
        // Only animate entry from below (element scrolling up into view)
        const comingFromBelow = entry.boundingClientRect.top > 0
        const duration = !el.__observed ? 0 : comingFromBelow ? 0.6 : 0
        gsap.to(el, { y: 0, opacity: 1, duration, ease: 'power2.out' })
      } else if (el.__observed) {
        // Only reverse when element exits below the viewport (scrolling up)
        const leftBelow = entry.boundingClientRect.top > entry.rootBounds.bottom
        if (leftBelow) {
          gsap.to(el, { y: 24, opacity: 0, duration: 0.4, ease: 'power2.in' })
        }
      }
    })
  }, { rootMargin: '0px 0px -15% 0px' })

  document.querySelectorAll('.animate-in').forEach(el => {
    gsap.set(el, { y: 24, opacity: 0 })
    // __observed tracks whether this element has been seen by the observer yet.
    // On the first intersection callback, elements already in the viewport
    // get duration: 0 (no animation). After that, __observed is set to true
    // so future intersections animate normally.
    el.__observed = false
    observer.observe(el)

    // Mark as observed after the first callback fires (microtask)
    requestAnimationFrame(() => { el.__observed = true })
  })
}
