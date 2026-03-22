// Thin interaction layer over the shared portal scene.
// All Three.js rendering lives in portal-scene.js (direct port of usePortalScene.ts).

import * as THREE from 'three'
import gsap from 'gsap'
import { createPortalScene, PORTAL_SCENE_DEFAULTS } from './portal-scene.js'
import { setupScrollAnimations, startObserving } from './scroll-animations.js'

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  initPortal()
}

function initPortal() {

  // Prevent the browser from restoring scroll position on refresh.
  // Without this, skip/play reveals the page at the old scroll offset
  // before snapping to the top.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  window.scrollTo(0, 0)

  const overlay = document.getElementById('trace-overlay')
  const content = document.getElementById('content')
  const instruction = document.getElementById('trace-instruction')
  const skipBtn = document.getElementById('skip-btn')
  const playBtn = document.getElementById('play-btn')
  document.documentElement.classList.add('no-scroll')
  document.body.classList.add('no-scroll')

  let w = window.innerWidth
  let h = window.innerHeight
  const TAU = Math.PI * 2

  // Timeline constants from usePortalTimelines.ts
  const CONTENT_SCALE_INITIAL = 0.95
  const CLIP_RADIUS_RATIO = 0.38
  const RING_SCALE_END = 14
  const CREATION_DURATION = 2.5
  const CONTENT_REVEAL_TIME = 1.8
  const ZOOM_FORWARD_DURATION = 2.8

  // --- Scene setup ---
  // Match the viewport aspect ratio so circles aren't stretched into ovals,
  // but keep the same total pixel budget as the presentation (980*552 ≈ 541K)
  // so bloom/haze look identical.
  const PRES_PIXELS = 980 * 552
  let SCENE_W, SCENE_H

  function calcSceneDims() {
    const aspect = w / h
    SCENE_H = Math.round(Math.sqrt(PRES_PIXELS / aspect))
    SCENE_W = Math.round(SCENE_H * aspect)
  }
  calcSceneDims()
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const opts = {
    ...PORTAL_SCENE_DEFAULTS,
    ringSize: Math.round(SCENE_H * (360 / 552)),
    dpr: 2,
    ...(isIOS
      ? { bloom: true, fakeBloom: false, haze: false, bloomStrength: 0.45, bloomRadius: 0, bloomThreshold: 0.1, emberFadePower: 0.3 }
      : { haze: true }
    ),
  }

  const state = {
    phase: 0,
    arcProgress: 0,
    arcStart: null,
    sparksActivated: 0,
    coreNeedsFullCircle: false,
  }

  const scene = createPortalScene(state, opts)
  scene.init(overlay, SCENE_W, SCENE_H)

  const canvasEl = scene.getRenderer().domElement

  // --- Guide ring (dashed circle showing where to trace) ---
  const guideRing = (() => {
    const geo = new THREE.RingGeometry(1.12, 1.18, 128)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0xf59e0b) },
        uOpacity: { value: opts.bloom ? 0.18 : 0.35 },
        uDashes: { value: 32.0 },
        uGap: { value: 0.45 },
        uArcStart: { value: 0.0 },
        uArcProgress: { value: 0.0 },
        uHintStart: { value: 0.0 },
        uHintEnd: { value: 0.0 },
      },
      vertexShader: `
        varying vec2 vPos;
        void main() {
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uDashes;
        uniform float uGap;
        uniform float uArcStart;
        uniform float uArcProgress;
        uniform float uHintStart;
        uniform float uHintEnd;
        varying vec2 vPos;
        #define TAU 6.2831853
        void main() {
          float angle = atan(vPos.y, vPos.x);
          // Discard fragments in the already-traced arc
          if (uArcProgress > 0.0) {
            float rel = mod(angle - uArcStart + TAU, TAU);
            if (rel < uArcProgress) discard;
          }
          float segment = fract(angle / TAU * uDashes);
          if (segment < uGap) discard;
          // Brighten dashes under the hint cursor
          float hintRel = mod(angle - uHintStart + TAU, TAU);
          float hintSpan = mod(uHintEnd - uHintStart + TAU, TAU);
          float boost = (hintSpan > 0.0 && hintRel < hintSpan) ? 3.0 : 1.0;
          gl_FragColor = vec4(uColor, min(uOpacity * boost, 1.0));
        }
      `,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.z = -0.02
    mesh.frustumCulled = false
    mesh.renderOrder = -1
    scene.getPortalGroup().add(mesh)
    return { mesh, geo, mat }
  })()

  // --- Interaction constants ---
  const SEGMENTS = 60

  // --- Hint dot animation (looping pointer cue) ---
  const HINT_ARC_DEG = 60
  const HINT_ARC_RAD = HINT_ARC_DEG * Math.PI / 180
  const HINT_SEGMENTS = Math.round(HINT_ARC_DEG / 360 * SEGMENTS) // 5
  const RING_RADIUS = 1.15

  let hintSprite = null
  let hintTimeline = null
  let hintTexture = null
  let hintMaterial = null
  let cursorSprite = null
  let cursorTexture = null
  let cursorMaterial = null

  function createHintSprite() {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(245, 158, 11, 1)')
    grad.addColorStop(0.4, 'rgba(245, 158, 11, 0.6)')
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    hintTexture = new THREE.CanvasTexture(canvas)
    hintMaterial = new THREE.SpriteMaterial({
      map: hintTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    })
    hintSprite = new THREE.Sprite(hintMaterial)
    hintSprite.scale.set(0.18, 0.18, 1)
    hintSprite.position.z = 0.02
    hintSprite.renderOrder = 11
    scene.getPortalGroup().add(hintSprite)

    // Cursor icon that follows the hint dot
    const cSize = 64
    const cCanvas = document.createElement('canvas')
    cCanvas.width = cSize
    cCanvas.height = cSize
    const cCtx = cCanvas.getContext('2d')
    // Draw pointer cursor at top-left of canvas
    cCtx.save()
    cCtx.translate(4, 4)
    const sc = cSize / 64
    cCtx.beginPath()
    cCtx.moveTo(0, 0)
    cCtx.lineTo(0, 40 * sc)
    cCtx.lineTo(11 * sc, 31 * sc)
    cCtx.lineTo(18 * sc, 46 * sc)
    cCtx.lineTo(24 * sc, 43 * sc)
    cCtx.lineTo(17 * sc, 28 * sc)
    cCtx.lineTo(28 * sc, 26 * sc)
    cCtx.closePath()
    cCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    cCtx.fill()
    cCtx.lineWidth = 1.5 * sc
    cCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
    cCtx.stroke()
    cCtx.restore()

    cursorTexture = new THREE.CanvasTexture(cCanvas)
    cursorMaterial = new THREE.SpriteMaterial({
      map: cursorTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    })
    cursorSprite = new THREE.Sprite(cursorMaterial)
    cursorSprite.scale.set(0.22, 0.22, 1)
    // Offset center so the cursor tip (top-left of canvas) sits at the sprite's position
    cursorSprite.center.set(0.06, 0.94)
    cursorSprite.position.z = 0.03
    cursorSprite.renderOrder = 12
    scene.getPortalGroup().add(cursorSprite)
  }

  function startHintAnimation(startAngle) {
    if (hintTimeline) hintTimeline.kill()
    if (!hintSprite) createHintSprite()

    let from = startAngle ?? Math.PI * 0.5 // default: 12 o'clock

    function currentFrom() {
      // Use the current frontier position so the hint stays with the user
      // Before tracing starts, stay at the initial position
      if (state.arcStart == null) return startAngle ?? Math.PI * 0.5
      return state.arcStart + (frontier / SEGMENTS) * TAU
    }

    function positionCursor(angle) {
      cursorSprite.position.x = Math.cos(angle) * RING_RADIUS
      cursorSprite.position.y = Math.sin(angle) * RING_RADIUS
    }

    // Position at start
    hintSprite.position.x = Math.cos(from) * RING_RADIUS
    hintSprite.position.y = Math.sin(from) * RING_RADIUS
    positionCursor(from)
    hintMaterial.opacity = 0
    cursorMaterial.opacity = 0

    // Use a 0-1 progress proxy so the arc length is always HINT_ARC_RAD
    // regardless of where `from` is when each loop starts
    const proxy = { t: 0 }
    hintTimeline = gsap.timeline({ repeat: -1, repeatDelay: 1.0,
      onRepeat() {
        // Update start position to current frontier each loop
        from = currentFrom()
        proxy.t = 0
        positionAt(0)
      },
    })

    const uniforms = guideRing.mat.uniforms

    function positionAt(t) {
      const a = from + t * HINT_ARC_RAD
      hintSprite.position.x = Math.cos(a) * RING_RADIUS
      hintSprite.position.y = Math.sin(a) * RING_RADIUS
      positionCursor(a)
      // Light up dashes from `from` to current hint position
      uniforms.uHintStart.value = from
      uniforms.uHintEnd.value = a
    }

    // Fade in
    hintTimeline.to(cursorMaterial, { opacity: 0.9, duration: 0.3, ease: 'power2.out' }, 0)
    // Trace arc
    hintTimeline.to(proxy, {
      t: 1,
      duration: 1.2,
      ease: 'power2.inOut',
      onUpdate() { positionAt(proxy.t) },
    }, 0.3)
    // Fade out — also clear the hint highlight
    hintTimeline.to(cursorMaterial, { opacity: 0, duration: 0.3, ease: 'power2.in',
      onComplete() { uniforms.uHintStart.value = 0; uniforms.uHintEnd.value = 0 },
    }, 1.5)
  }

  function relocateHint(angle) {
    startHintAnimation(angle)
  }

  function killHintAnimation() {
    if (!hintTimeline) return
    hintTimeline.kill()
    hintTimeline = null
    if (hintSprite) {
      gsap.to(hintMaterial, {
        opacity: 0,
        duration: 0.2,
        ease: 'power2.out',
        onComplete() {
          scene.getPortalGroup().remove(hintSprite)
          hintMaterial.dispose()
          hintTexture.dispose()
          hintSprite = null
          hintMaterial = null
          hintTexture = null
        },
      })
    }
    if (cursorSprite) {
      gsap.to(cursorMaterial, {
        opacity: 0,
        duration: 0.2,
        ease: 'power2.out',
        onComplete() {
          scene.getPortalGroup().remove(cursorSprite)
          cursorMaterial.dispose()
          cursorTexture.dispose()
          cursorSprite = null
          cursorMaterial = null
          cursorTexture = null
        },
      })
    }
  }

  // Start the hint loop
  startHintAnimation()

  // --- Portal window & zoom (from usePortalTimelines.ts) ---
  // clipR must be in viewport pixels, not scene pixels. Scale from scene coords.
  let viewportScale = h / SCENE_H
  let clipR = (opts.ringSize * CLIP_RADIUS_RATIO * viewportScale) / CONTENT_SCALE_INITIAL

  // Scene is ready — clear loading hint
  const loadingHint = document.getElementById('loading-hint')
  if (loadingHint) loadingHint.textContent = ''
  instruction.classList.add('visible')
  gsap.fromTo(playBtn, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out', onStart() { playBtn.style.pointerEvents = 'auto' } })
  let contentOverlay = null
  let revealTl = null
  let windowShown = false

  function showPortalWindow() {
    if (windowShown) return
    windowShown = true

    // Use dvh/dvw for overshoot so it tracks iOS viewport changes
    // (address bar retraction) in real-time instead of stale pixel values.
    const overPct = ((1 / CONTENT_SCALE_INITIAL - 1) / 2 * 100).toFixed(4)

    overlay.appendChild(content)
    Object.assign(content.style, {
      position: 'absolute',
      inset: `-${overPct}dvh -${overPct}dvw`,
      boxSizing: 'content-box',
      padding: `${overPct}dvh ${overPct}dvw`,
      zIndex: '2',
      transformOrigin: 'center center',
      transform: `scale(${CONTENT_SCALE_INITIAL})`,
      clipPath: `circle(${clipR}px at 50% 50%)`,
      visibility: 'visible',
      background: 'var(--color-bg)',
      overflow: 'hidden',
    })
    content.classList.add('preview')

    contentOverlay = document.createElement('div')
    Object.assign(contentOverlay.style, {
      position: 'absolute',
      inset: '0',
      background: '#000',
      zIndex: '3',
      pointerEvents: 'none',
    })
    content.appendChild(contentOverlay)

    canvasEl.style.zIndex = '5'

    // Reversible reveal timeline (overlay + buttons only)
    revealTl = gsap.timeline()
    revealTl.to(contentOverlay, {
      opacity: 0, duration: 1.0, ease: 'power2.out',
    }, 0)
    revealTl.to([skipBtn, playBtn, btnRow], {
      opacity: 0, duration: 1.0, ease: 'power2.out',
      onComplete() { skipBtn.style.pointerEvents = 'none'; playBtn.style.pointerEvents = 'none'; btnRow.style.pointerEvents = 'none' },
    }, 0)

    // Use IntersectionObserver for content reveal — handles resize naturally
    startObserving()
  }

  function hidePortalWindow() {
    if (!revealTl) return
    revealTl.reverse()
  }

  function applyProgress(p) {
    const maxR = Math.hypot(w, h) / (2 * CONTENT_SCALE_INITIAL)
    const ringScale = 1 + (RING_SCALE_END - 1) * p
    const currentClip = Math.min(clipR * ringScale, maxR)
    const contentScale = CONTENT_SCALE_INITIAL + (1 - CONTENT_SCALE_INITIAL) * p

    content.style.transform = `scale(${contentScale})`
    content.style.clipPath = `circle(${currentClip}px at 50% 50%)`
    scene.getPortalGroup()?.scale.setScalar(ringScale)
    canvasEl.style.opacity = `${Math.max(0, 1 - p * p * p * 2.5)}`
  }

  function clearPortalStyles() {
    content.style.position = ''
    content.style.inset = ''
    content.style.boxSizing = ''
    content.style.padding = ''
    content.style.zIndex = ''
    content.style.transformOrigin = ''
    content.style.transform = ''
    content.style.clipPath = 'none'
    content.style.visibility = 'visible'
    content.style.overflow = ''
  }

  let zooming = false
  function animateZoom() {
    portalActive = false
    zooming = true
    const proxy = { progress: 0 }
    gsap.timeline({
      onComplete() {
        zooming = false
        if (revealTl) { revealTl.kill(); revealTl = null }
        scene.dispose()
        if (contentOverlay) contentOverlay.remove()
        btnRow.remove()
        panel.remove()
        document.body.insertBefore(content, overlay)
        overlay.remove()
        clearPortalStyles()
        window.scrollTo(0, 0)
        document.documentElement.classList.remove('no-scroll')
        document.body.classList.remove('no-scroll')
        setupScrollAnimations()
      },
    }).to(proxy, {
      progress: 1,
      duration: ZOOM_FORWARD_DURATION,
      ease: 'expo.in',
      onUpdate() { applyProgress(proxy.progress) },
    })
  }

  function skipReveal() {
    killHintAnimation()
    if (revealTl) { revealTl.kill(); revealTl = null }
    guideRing.geo.dispose()
    guideRing.mat.dispose()
    scene.dispose()
    if (contentOverlay) contentOverlay.remove()
    btnRow.remove()
    panel.remove()
    document.body.insertBefore(content, overlay)
    clearPortalStyles()
    overlay.classList.add('skip-fade')
    overlay.addEventListener('transitionend', () => {
      overlay.remove()
      window.scrollTo(0, 0)
      document.documentElement.classList.remove('no-scroll')
      document.body.classList.remove('no-scroll')
      setupScrollAnimations()
    }, { once: true })
  }


  // --- Interaction: tracing ---
  let frontier = 0
  let tracing = false
  let targetArcProgress = 0
  let smoothArcProgress = 0
  let autoCompleting = false
  let playingCreation = false
  let completionTime = 0

  function getAngle(e) {
    const rect = canvasEl.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0
    return Math.atan2(-(clientY - rect.top - cy), clientX - rect.left - cx)
  }

  function updateTrace(angle) {
    const offset = state.arcStart ?? 0
    const normalized = (((angle - offset) % TAU) + TAU) % TAU
    const seg = Math.floor(normalized / TAU * SEGMENTS) % SEGMENTS
    // Only advance if within a few segments ahead of the frontier
    const ahead = seg - frontier
    if (ahead > 0 && ahead < SEGMENTS * 0.3) {
      frontier = seg
    }
    targetArcProgress = (frontier / SEGMENTS) * TAU
    if (frontier >= HINT_SEGMENTS) {
      killHintAnimation()
    }
    if (frontier >= SEGMENTS * 0.85 && state.phase === 1 && !autoCompleting) {
      beginAutoComplete()
    }
  }

  canvasEl.addEventListener('pointerdown', e => {
    if (state.phase >= 2) return
    e.preventDefault()
    tracing = true
    if (state.phase === 0) {
      state.phase = 1
      state.arcStart = getAngle(e)
      guideRing.mat.uniforms.uArcStart.value = state.arcStart
      instruction.classList.add('hidden')
      relocateHint(state.arcStart)
    }
    updateTrace(getAngle(e))
  })
  canvasEl.addEventListener('pointermove', e => {
    if (!tracing || state.phase >= 2) return
    e.preventDefault()
    updateTrace(getAngle(e))
  })
  const endTrace = () => {
    if (tracing && state.phase === 1 && frontier > 0 && frontier < HINT_SEGMENTS && hintTimeline) {
      const frontierAngle = (state.arcStart ?? 0) + (frontier / SEGMENTS) * TAU
      relocateHint(frontierAngle)
    }
    tracing = false
  }
  canvasEl.addEventListener('pointerup', endTrace)
  canvasEl.addEventListener('pointercancel', endTrace)
  canvasEl.addEventListener('pointerleave', endTrace)

  let portalActive = true
  skipBtn.addEventListener('click', () => { if (portalActive) { portalActive = false; skipReveal() } })
  playBtn.addEventListener('click', playCreation)

  // Resize portal to match new viewport
  let resizeTimer
  window.addEventListener('resize', () => {
    w = window.innerWidth
    h = window.innerHeight
    calcSceneDims()
    viewportScale = h / SCENE_H
    clipR = (opts.ringSize * CLIP_RADIUS_RATIO * viewportScale) / CONTENT_SCALE_INITIAL
    if (portalActive || zooming) {
      // Update camera + renderer immediately to prevent aspect ratio stretch
      scene.resize(SCENE_W, SCENE_H)
      // Debounce the expensive composer/bloom resize
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        scene.resizeComposer(SCENE_W, SCENE_H)
      }, 100)
    }
  })

  // --- Play creation (matches usePortalTimelines.playCreation) ---
  function playCreation() {
    if (state.phase >= 2 || autoCompleting || playingCreation) return
    killHintAnimation()

    const midTrace = state.phase === 1
    const startArc = midTrace ? state.arcProgress : 0
    if (!midTrace) state.phase = 1
    playingCreation = true
    tracing = false
    instruction.classList.add('hidden')

    const remaining = Math.max(0.01, (TAU - startArc) / TAU)
    const duration = Math.max(0.6, CREATION_DURATION * remaining)
    const showWindowAt = midTrace && startArc >= TAU * 0.5
      ? 0
      : Math.min(duration * 0.7, CONTENT_REVEAL_TIME)

    const proxy = { arc: startArc }
    const tl = gsap.timeline({
      onComplete() {
        playingCreation = false
        setReadyState()
      },
    })
    tl.to(proxy, {
      arc: TAU,
      duration,
      ease: 'power2.inOut',
      onUpdate() {
        state.arcProgress = proxy.arc
        smoothArcProgress = proxy.arc
        targetArcProgress = proxy.arc
      },
    })
    tl.call(() => showPortalWindow(), [], showWindowAt)
  }

  // --- Auto-complete (tracing reaches 85%) ---
  function beginAutoComplete() {
    autoCompleting = true
    showPortalWindow()
    const startArc = smoothArcProgress
    const proxy = { arc: startArc }
    gsap.to(proxy, {
      arc: TAU, duration: 0.7, ease: 'power2.out',
      onUpdate() {
        targetArcProgress = proxy.arc
        smoothArcProgress = proxy.arc
        state.arcProgress = proxy.arc
      },
      onComplete() { setReadyState() },
    })
  }

  function setReadyState() {
    state.phase = 2
    state.arcProgress = TAU
    state.sparksActivated = Infinity
    state.coreNeedsFullCircle = true
    if (!windowShown) showPortalWindow()
    guideRing.mat.uniforms.uArcProgress.value = TAU
    guideRing.mat.uniforms.uOpacity.value = 0
  }

  // --- Smoothing loop for tracing (runs alongside scene's own loop) ---
  let smoothId = 0
  let lastSmooth = performance.now() * 0.001

  function smoothLoop() {
    const t = performance.now() * 0.001
    lastSmooth = t

    const lerpSpeed = state.phase >= 2 ? 0.2 : 0.12
    smoothArcProgress += (targetArcProgress - smoothArcProgress) * lerpSpeed

    if (state.phase === 1 && !autoCompleting && !playingCreation) {
      state.arcProgress = smoothArcProgress
      // Hide traced portion of guide ring
      guideRing.mat.uniforms.uArcProgress.value = smoothArcProgress
    } else if (state.phase === 2) {
      if (completionTime === 0) completionTime = t
      if (t - completionTime > 0.4) {
        state.phase = 3
        animateZoom()
        return // stop smooth loop, zoom takes over
      }
    }

    smoothId = requestAnimationFrame(smoothLoop)
  }

  smoothLoop()

  // --- Debug panel ---
  const panel = document.createElement('div')
  Object.assign(panel.style, {
    position: 'fixed', top: '50px', right: '16px', zIndex: '9999',
    background: 'rgba(0, 0, 0, 0.88)', padding: '12px 14px', borderRadius: '8px',
    color: '#e8e8ed', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px',
    maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden', width: '260px',
    display: 'none', backdropFilter: 'blur(8px)',
    border: '1px solid rgba(245, 158, 11, 0.15)', boxSizing: 'border-box',
  })
  // document.body.appendChild(panel) // uncomment to enable debug UI

  // --- Top-right button row ---
  const btnRow = document.createElement('div')
  Object.assign(btnRow.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '9999',
    display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '340px',
  })
  // document.body.appendChild(btnRow) // uncomment to enable debug UI

  const btnStyle = {
    padding: '8px 14px', border: 'none', borderRadius: '6px',
    background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b',
    fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px',
    cursor: 'pointer', backdropFilter: 'blur(8px)',
  }

  const debugBtn = document.createElement('button')
  debugBtn.textContent = 'Debug'
  Object.assign(debugBtn.style, btnStyle)
  debugBtn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
  })
  btnRow.appendChild(debugBtn)

  // Desktop defaults
  const DESKTOP_REAL = { bloom: true, fakeBloom: false, haze: true, coreSize: 0.01, emberSize: 0.06, hazeIntensity: 1.3, bloomStrength: 0.4, bloomRadius: 0.4, bloomThreshold: 0.25 }
  const DESKTOP_FAKE = { bloom: false, fakeBloom: true, haze: true, coreSize: 0.01, emberSize: 0.06, hazeIntensity: 2.2 }
  // iOS defaults
  const IOS_REAL = { bloom: true, fakeBloom: false, haze: false, coreSize: 0.01, emberSize: 0.06, hazeIntensity: 1.3, bloomStrength: 0.45, bloomRadius: 0, bloomThreshold: 0.1, emberFadePower: 0.3 }
  const IOS_FAKE = { bloom: false, fakeBloom: true, haze: true, coreSize: 0.01, emberSize: 0.06, hazeIntensity: 2.2 }

  const modeButtons = []

  let activePreset = null
  const sliders = []

  function refreshSliders() {
    for (const s of sliders) {
      s.input.value = s.get()
      s.val.textContent = Number(s.get()).toFixed(2)
    }
  }

  function applyMode(preset) {
    activePreset = preset
    Object.assign(opts, preset)
    guideRing.mat.uniforms.uOpacity.value = opts.bloom ? 0.18 : 0.35
    guideRing.mesh.position.z = opts.bloom ? 0.01 : -0.02
    guideRing.mesh.renderOrder = opts.bloom ? 10 : -1
    modeButtons.forEach(b => b.el.style.background = 'rgba(245, 158, 11, 0.2)')
    preset._btn.style.background = 'rgba(245, 158, 11, 0.5)'
    refreshSliders()
  }

  function addModeBtn(label, preset) {
    const btn = document.createElement('button')
    btn.textContent = label
    Object.assign(btn.style, btnStyle, { fontSize: '11px', padding: '6px 10px' })
    btn.addEventListener('click', () => applyMode(preset))
    btnRow.appendChild(btn)
    preset._btn = btn
    modeButtons.push({ el: btn, preset })
    return btn
  }

  addModeBtn('Desktop Real', DESKTOP_REAL)
  addModeBtn('Desktop Fake', DESKTOP_FAKE)
  addModeBtn('iOS Real', IOS_REAL)
  addModeBtn('iOS Fake', IOS_FAKE)

  // Highlight initial mode
  // applyMode(isIOS ? IOS_FAKE : DESKTOP_FAKE) // uncomment to enable debug UI

  function addSection(label) {
    const h = document.createElement('div')
    h.textContent = label
    Object.assign(h.style, { color: '#f59e0b', fontWeight: '600', fontSize: '11px', margin: '10px 0 4px', letterSpacing: '0.05em' })
    panel.appendChild(h)
  }

  function addSlider(label, get, set, min, max, step) {
    const row = document.createElement('div')
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', margin: '3px 0' })

    const lbl = document.createElement('span')
    lbl.textContent = label
    Object.assign(lbl.style, { width: '80px', flexShrink: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

    const input = document.createElement('input')
    input.type = 'range'
    input.min = min; input.max = max; input.step = step
    input.value = get()
    Object.assign(input.style, { flex: '1', minWidth: '0', accentColor: '#f59e0b', height: '14px' })

    const val = document.createElement('span')
    val.textContent = Number(get()).toFixed(2)
    Object.assign(val.style, { width: '34px', flexShrink: '0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px' })

    input.addEventListener('input', () => {
      set(parseFloat(input.value))
      val.textContent = parseFloat(input.value).toFixed(2)
    })

    row.appendChild(lbl)
    row.appendChild(input)
    row.appendChild(val)
    panel.appendChild(row)
    sliders.push({ input, val, get, set })
    return input
  }

  const defaults = { ...PORTAL_SCENE_DEFAULTS }

  function resetAll() {
    for (const key of Object.keys(defaults)) opts[key] = defaults[key]
    if (activePreset) Object.assign(opts, activePreset)
    refreshSliders()
  }

  const resetBtn = document.createElement('button')
  resetBtn.textContent = 'Reset'
  Object.assign(resetBtn.style, {
    width: '100%', padding: '5px', margin: '4px 0 6px', border: 'none', borderRadius: '4px',
    background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b',
    fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px', cursor: 'pointer',
  })
  resetBtn.addEventListener('click', resetAll)
  panel.appendChild(resetBtn)

  addSection('GLOW HALOS')
  addSlider('Glow size', () => opts.glowSize, v => opts.glowSize = v, 0.05, 1.0, 0.01)
  addSlider('Glow opacity', () => opts.glowOpacity, v => opts.glowOpacity = v, 0.01, 0.4, 0.01)
  addSlider('Core glow sz', () => opts.coreGlowSize, v => opts.coreGlowSize = v, 0.05, 1.0, 0.01)
  addSlider('Core glow op', () => opts.coreGlowOpacity, v => opts.coreGlowOpacity = v, 0.01, 0.4, 0.01)

  addSection('PARTICLES')
  addSlider('Ember size', () => opts.emberSize, v => opts.emberSize = v, 0.01, 0.2, 0.005)
  addSlider('Core size', () => opts.coreSize, v => opts.coreSize = v, 0.01, 0.3, 0.005)
  addSlider('Ember opacity', () => opts.fakeBloomEmberOpacity, v => opts.fakeBloomEmberOpacity = v, 0.1, 1.0, 0.05)
  addSlider('Core opacity', () => opts.fakeBloomCoreOpacity, v => opts.fakeBloomCoreOpacity = v, 0.1, 1.0, 0.05)
  addSlider('Trail boost', () => opts.trailBoost, v => opts.trailBoost = v, 1.0, 3.0, 0.1)
  addSlider('Ember fade', () => opts.emberFadePower, v => opts.emberFadePower = v, 0.3, 6.0, 0.1)
  addSlider('Trail fade', () => opts.trailFadePower, v => opts.trailFadePower = v, 0.3, 6.0, 0.1)

  addSection('HAZE')
  addSlider('Haze intensity', () => opts.hazeIntensity, v => opts.hazeIntensity = v, 0.0, 5.0, 0.1)
  addSlider('Haze boost', () => opts.hazeBoost, v => opts.hazeBoost = v, 0.5, 5.0, 0.1)

  addSection('BLOOM (real)')
  addSlider('Strength', () => opts.bloomStrength, v => opts.bloomStrength = v, 0.0, 2.0, 0.05)
  addSlider('Radius', () => opts.bloomRadius, v => opts.bloomRadius = v, 0.0, 1.0, 0.05)
  addSlider('Threshold', () => opts.bloomThreshold, v => opts.bloomThreshold = v, 0.0, 1.0, 0.05)

  document.addEventListener('keydown', e => {
    if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey && e.target === document.body) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
    }
  })

  // --- Debug API ---
  window.__portalDebug = {
    get phase() { return state.phase },
    skipToPhase2() {
      frontier = SEGMENTS
      targetArcProgress = TAU
      smoothArcProgress = TAU
      setReadyState()
    },
    pauseZoom() { completionTime = Infinity },
    resumeZoom() { completionTime = performance.now() * 0.001 - 0.5 },
    getState() { return { ...state, windowShown, completionTime } },
  }
}
