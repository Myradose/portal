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
    // Don't reset elements already made visible by the portal reveal
    const alreadyVisible = parseFloat(getComputedStyle(el).opacity) > 0.5
    if (!alreadyVisible) {
      gsap.set(el, { y: 24, opacity: 0 })
    }
    el.__observed = alreadyVisible
    observer.observe(el)

    // Mark as observed after the first callback fires (microtask)
    requestAnimationFrame(() => { el.__observed = true })
  })
}
