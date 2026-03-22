// Thin interaction layer over the shared portal scene.
// All Three.js rendering lives in portal-scene.js (direct port of usePortalScene.ts).

import * as THREE from 'three'
import { createPortalScene, PORTAL_SCENE_DEFAULTS } from './portal-scene.js'
import { setupScrollAnimations, startObserving } from './scroll-animations.js'

if (!window.__portalBlocked && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const params = new URLSearchParams(window.location.search)
  const loadingDelay = params.get('loading')
  const delay = loadingDelay === '1' ? 5000 : loadingDelay === '2' ? 10000 : 0
  setTimeout(() => {
    window.__portalInitialized = true
    initPortal()
  }, delay)
}

function initPortal() {

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
  const opts = { ...PORTAL_SCENE_DEFAULTS, ringSize: Math.round(SCENE_H * (360 / 552)), dpr: 2, haze: !isIOS }

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
        uOpacity: { value: 0.18 },
        uDashes: { value: 32.0 },
        uGap: { value: 0.45 },
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
        varying vec2 vPos;
        #define TAU 6.2831853
        void main() {
          float angle = atan(vPos.y, vPos.x);
          float segment = fract(angle / TAU * uDashes);
          if (segment < uGap) discard;
          gl_FragColor = vec4(uColor, uOpacity);
        }
      `,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.z = 0.01
    mesh.frustumCulled = false
    mesh.renderOrder = 10
    scene.getPortalGroup().add(mesh)
    return { mesh, geo, mat }
  })()

  // --- Interaction constants ---
  const SEGMENTS = 60

  // --- Hint dot animation (looping pointer cue) ---
  const HINT_ARC_DEG = 30
  const HINT_ARC_RAD = HINT_ARC_DEG * Math.PI / 180
  const HINT_SEGMENTS = Math.round(HINT_ARC_DEG / 360 * SEGMENTS) // 5
  const RING_RADIUS = 1.15

  let hintSprite = null
  let hintTimeline = null
  let hintTexture = null
  let hintMaterial = null

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
  }

  function startHintAnimation(startAngle) {
    if (hintTimeline) hintTimeline.kill()
    if (!hintSprite) createHintSprite()

    const from = startAngle ?? Math.PI * 0.5 // default: 12 o'clock
    const to = from + HINT_ARC_RAD

    // Position at start
    hintSprite.position.x = Math.cos(from) * RING_RADIUS
    hintSprite.position.y = Math.sin(from) * RING_RADIUS
    hintMaterial.opacity = 0

    const proxy = { angle: from }
    hintTimeline = gsap.timeline({ repeat: -1, repeatDelay: 1.0 })

    // Fade in
    hintTimeline.to(hintMaterial, { opacity: 0.9, duration: 0.3, ease: 'power2.out' }, 0)
    // Trace arc
    hintTimeline.to(proxy, {
      angle: to,
      duration: 1.2,
      ease: 'power2.inOut',
      onUpdate() {
        hintSprite.position.x = Math.cos(proxy.angle) * RING_RADIUS
        hintSprite.position.y = Math.sin(proxy.angle) * RING_RADIUS
      },
    }, 0.3)
    // Fade out
    hintTimeline.to(hintMaterial, { opacity: 0, duration: 0.3, ease: 'power2.in' }, 1.5)
    // Reset position for next loop
    hintTimeline.call(() => {
      proxy.angle = from
      hintSprite.position.x = Math.cos(from) * RING_RADIUS
      hintSprite.position.y = Math.sin(from) * RING_RADIUS
    }, [], 1.8)
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
  }

  // Start the hint loop
  startHintAnimation()

  // --- Portal window & zoom (from usePortalTimelines.ts) ---
  // clipR must be in viewport pixels, not scene pixels. Scale from scene coords.
  let viewportScale = h / SCENE_H
  let clipR = (opts.ringSize * CLIP_RADIUS_RATIO * viewportScale) / CONTENT_SCALE_INITIAL

  // Clear loading hint and show trace instruction + play button now that portal is ready
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
    revealTl.to([skipBtn, playBtn], {
      opacity: 0, duration: 1.0, ease: 'power2.out',
      onComplete() { skipBtn.style.pointerEvents = 'none'; playBtn.style.pointerEvents = 'none' },
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
  // iOS Safari delays updating innerWidth/innerHeight on orientation change,
  // so we debounce all resize paths and re-read dimensions after a short delay.
  let resizeTimer
  function applyResize() {
    w = window.innerWidth
    h = window.innerHeight
    calcSceneDims()
    viewportScale = h / SCENE_H
    clipR = (opts.ringSize * CLIP_RADIUS_RATIO * viewportScale) / CONTENT_SCALE_INITIAL
    if (portalActive || zooming) {
      scene.resize(SCENE_W, SCENE_H)
      scene.resizeComposer(SCENE_W, SCENE_H)
    }
  }
  function scheduleResize() {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(applyResize, 120)
  }
  window.addEventListener('resize', scheduleResize)
  window.addEventListener('orientationchange', scheduleResize)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleResize)
  }

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
    gsap.to(guideRing.mat.uniforms.uOpacity, { value: 0, duration: 0.5, ease: 'power2.out' })
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
