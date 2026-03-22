// Shared portal scene — single source of truth for both the Slidev presentation
// and the standalone index.html page.
//
// Written in plain JS so the browser can import it directly (via import map).
// TypeScript consumers: see usePortalScene.d.ts for type definitions.

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export const PORTAL_SCENE_DEFAULTS = {
  ground: true,
  sparks: true,
  core: true,
  haze: true,
  bloom: true,
  ringSpeed: 13.5,
  trailLen: 0.16,
  bloomStrength: 0.4,
  bloomRadius: 0.4,
  bloomThreshold: 0.25,
  coreSize: 0.01,
  emberSize: 0.06,
  hazeIntensity: 1.3,
  groundY: -1.18,
  groundDim: 0.35,
  fakeBloom: false,
  glowSize: 0.08,
  glowOpacity: 0.10,
  coreGlowSize: 0.55,
  coreGlowOpacity: 0.05,
  trailBoost: 1.0,
  fakeBloomEmberOpacity: 0.60,
  fakeBloomCoreOpacity: 0.75,
  hazeBoost: 0.8,
  emberFadePower: 3,
  trailFadePower: 2,
}

const RING_RADIUS = 1.15
const SPARK_COUNT = 2800
const CORE_COUNT = 800
const DEFAULT_ARC_START = Math.PI / 2

function createGlowTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 180, 60, 0.9)')
  gradient.addColorStop(0.2, 'rgba(240, 120, 20, 0.6)')
  gradient.addColorStop(0.5, 'rgba(200, 60, 5, 0.25)')
  gradient.addColorStop(0.8, 'rgba(140, 20, 2, 0.08)')
  gradient.addColorStop(1, 'rgba(80, 5, 0, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

// --- Spark subsystem ---

function createSparkSystem(state, opts, glowTex, portalGroup) {
  const sparkX = new Float32Array(SPARK_COUNT)
  const sparkY = new Float32Array(SPARK_COUNT)
  const sparkVx = new Float32Array(SPARK_COUNT)
  const sparkVy = new Float32Array(SPARK_COUNT)
  const sparkAge = new Float32Array(SPARK_COUNT)
  const sparkMaxAge = new Float32Array(SPARK_COUNT)
  const sparkZ = new Float32Array(SPARK_COUNT)
  const sparkGrounded = new Uint8Array(SPARK_COUNT)

  function spawn(i, t) {
    let ringAngle
    if (state.phase === 1 || state.phase === 3) {
      ringAngle = (state.arcStart ?? DEFAULT_ARC_START) + Math.random() * state.arcProgress
    } else {
      ringAngle = t * opts.ringSpeed + Math.random() * Math.PI * 2
    }
    const r = RING_RADIUS + (Math.random() - 0.5) * 0.06
    sparkX[i] = Math.cos(ringAngle) * r
    sparkY[i] = Math.sin(ringAngle) * r
    sparkZ[i] = (Math.random() - 0.5) * 0.08

    const tangentSpeed = opts.ringSpeed * r
    const tx = -Math.sin(ringAngle)
    const ty = Math.cos(ringAngle)
    const rx = Math.cos(ringAngle)
    const ry = Math.sin(ringAngle)
    const radialKick = 0.1 + Math.random() * 0.3
    const jitter = (Math.random() - 0.5) * 0.2
    sparkVx[i] = tx * tangentSpeed * (0.15 + Math.random() * 0.15) + rx * radialKick + jitter
    sparkVy[i] = ty * tangentSpeed * (0.15 + Math.random() * 0.15) + ry * radialKick + jitter

    sparkAge[i] = 0
    sparkMaxAge[i] = 0.12 + Math.random() * 0.35
    sparkGrounded[i] = 0
  }

  function killAll() {
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparkAge[i] = 999
      sparkMaxAge[i] = 1
    }
    sparkGrounded.fill(0)
  }

  killAll()

  const trailPositions = new Float32Array(SPARK_COUNT * 2 * 3)
  const trailColors = new Float32Array(SPARK_COUNT * 2 * 3)
  const trailGeo = new THREE.BufferGeometry()
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3))
  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const trailMesh = new THREE.LineSegments(trailGeo, trailMat)
  trailMesh.frustumCulled = false
  portalGroup.add(trailMesh)

  const emberPositions = new Float32Array(SPARK_COUNT * 3)
  const emberColors = new Float32Array(SPARK_COUNT * 3)
  const emberGeo = new THREE.BufferGeometry()
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3))
  emberGeo.setAttribute('color', new THREE.BufferAttribute(emberColors, 3))
  const emberMat = new THREE.PointsMaterial({
    map: glowTex,
    size: opts.emberSize,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const emberMesh = new THREE.Points(emberGeo, emberMat)
  emberMesh.frustumCulled = false
  portalGroup.add(emberMesh)

  // Glow halo layer (fake bloom for iOS)
  const glowPositions = new Float32Array(SPARK_COUNT * 3)
  const glowColors = new Float32Array(SPARK_COUNT * 3)
  const glowGeo = new THREE.BufferGeometry()
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3))
  glowGeo.setAttribute('color', new THREE.BufferAttribute(glowColors, 3))
  const glowMat = new THREE.PointsMaterial({
    map: glowTex,
    size: opts.glowSize,
    vertexColors: true,
    transparent: true,
    opacity: opts.glowOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const glowMesh = new THREE.Points(glowGeo, glowMat)
  glowMesh.frustumCulled = false
  portalGroup.add(glowMesh)

  function update(dt, t) {
    trailMesh.visible = opts.sparks
    emberMesh.visible = opts.sparks
    glowMesh.visible = opts.fakeBloom && opts.sparks
    if (!opts.sparks) return

    if (state.phase === 1 || state.phase === 3) {
      state.sparksActivated = Math.floor((state.arcProgress / (Math.PI * 2)) * SPARK_COUNT)
    }

    const tPos = trailGeo.attributes.position.array
    const tCol = trailGeo.attributes.color.array
    const ePos = emberGeo.attributes.position.array
    const eCol = emberGeo.attributes.color.array
    const gPos = glowGeo.attributes.position.array
    const gCol = glowGeo.attributes.color.array

    for (let i = 0; i < SPARK_COUNT; i++) {
      sparkAge[i] += dt

      if (sparkAge[i] >= sparkMaxAge[i]) {
        if (state.phase >= 1 && i < state.sparksActivated) {
          spawn(i, t)
        } else {
          ePos[i * 3] = 0; ePos[i * 3 + 1] = 0; ePos[i * 3 + 2] = -999
          eCol[i * 3] = 0; eCol[i * 3 + 1] = 0; eCol[i * 3 + 2] = 0
          gPos[i * 3] = 0; gPos[i * 3 + 1] = 0; gPos[i * 3 + 2] = -999
          gCol[i * 3] = 0; gCol[i * 3 + 1] = 0; gCol[i * 3 + 2] = 0
          tPos[i * 6] = 0; tPos[i * 6 + 1] = 0; tPos[i * 6 + 2] = -999
          tPos[i * 6 + 3] = 0; tPos[i * 6 + 4] = 0; tPos[i * 6 + 5] = -999
          tCol[i * 6] = 0; tCol[i * 6 + 1] = 0; tCol[i * 6 + 2] = 0
          tCol[i * 6 + 3] = 0; tCol[i * 6 + 4] = 0; tCol[i * 6 + 5] = 0
          continue
        }
      }

      if (opts.ground) sparkVy[i] -= 0.8 * dt

      sparkX[i] += sparkVx[i] * dt
      sparkY[i] += sparkVy[i] * dt

      sparkVx[i] *= (1 - 3.0 * dt)
      sparkVy[i] *= (1 - 3.0 * dt)

      if (opts.ground && sparkY[i] < opts.groundY) {
        sparkY[i] = opts.groundY
        sparkVy[i] = 0
        sparkVx[i] *= 0.85
        sparkGrounded[i] = 1
      }

      const life = sparkAge[i] / sparkMaxAge[i]

      const hx = sparkX[i]
      const hy = sparkY[i]
      const hz = sparkZ[i]
      const trailScale = Math.max(0, 1 - life * life)
      const rawTailX = hx - sparkVx[i] * opts.trailLen * trailScale
      const rawTailY = hy - sparkVy[i] * opts.trailLen * trailScale

      let tailX, tailY, headX, headY
      if (sparkGrounded[i]) {
        tailX = rawTailX
        tailY = rawTailY
        headX = hx
        headY = hy
      } else {
        const rawTailDist = Math.sqrt(rawTailX * rawTailX + rawTailY * rawTailY)
        tailX = rawTailDist > 0 ? (rawTailX / rawTailDist) * RING_RADIUS : rawTailX
        tailY = rawTailDist > 0 ? (rawTailY / rawTailDist) * RING_RADIUS : rawTailY
        headX = tailX + (hx - tailX) * trailScale
        headY = tailY + (hy - tailY) * trailScale
      }

      const dist = Math.sqrt(hx * hx + hy * hy)
      const distFromRing = Math.max(0, dist - RING_RADIUS)
      const rs = Math.min(1, distFromRing * 7.0)
      const trailFade = Math.max(0, 1 - Math.pow(life, opts.trailFadePower))
      const emberFade = Math.max(0, 1 - Math.pow(life, opts.emberFadePower))

      const dim = sparkGrounded[i] ? opts.groundDim : 1.0

      tPos[i * 6] = headX
      tPos[i * 6 + 1] = headY
      tPos[i * 6 + 2] = hz
      tPos[i * 6 + 3] = tailX
      tPos[i * 6 + 4] = tailY
      tPos[i * 6 + 5] = hz

      tCol[i * 6]     = (0.6 - rs * 0.15) * trailFade * dim
      tCol[i * 6 + 1] = (0.25 - rs * 0.22) * trailFade * dim
      tCol[i * 6 + 2] = (0.02 - rs * 0.02) * trailFade * dim
      const trs = Math.min(1, rs + 0.4)
      const tailDim = trailFade * 0.6
      tCol[i * 6 + 3] = (0.5 - trs * 0.15) * tailDim * dim
      tCol[i * 6 + 4] = (0.1 - trs * 0.09) * tailDim * dim
      tCol[i * 6 + 5] = 0.0

      if (opts.fakeBloom) {
        const tb = opts.trailBoost
        tCol[i * 6] *= tb
        tCol[i * 6 + 1] *= tb
        tCol[i * 6 + 2] *= tb
        tCol[i * 6 + 3] *= tb
        tCol[i * 6 + 4] *= tb
        tCol[i * 6 + 5] *= tb
      }

      if (emberFade > 0.05) {
        ePos[i * 3] = hx
        ePos[i * 3 + 1] = hy
        ePos[i * 3 + 2] = hz
        // ember color: base amber * emberFade * dim
        const ef = emberFade * dim
        eCol[i * 3]     = 0.93 * ef  // 0xee -> 0.93
        eCol[i * 3 + 1] = 0.53 * ef  // 0x88 -> 0.53
        eCol[i * 3 + 2] = 0.07 * ef  // 0x11 -> 0.07
        gPos[i * 3] = hx
        gPos[i * 3 + 1] = hy
        gPos[i * 3 + 2] = hz - 0.001
        // glow color: warmer amber * fade * dim
        gCol[i * 3]     = 0.93 * ef
        gCol[i * 3 + 1] = 0.53 * ef
        gCol[i * 3 + 2] = 0.20 * ef
      } else {
        ePos[i * 3] = 0
        ePos[i * 3 + 1] = 0
        ePos[i * 3 + 2] = -999
        eCol[i * 3] = 0; eCol[i * 3 + 1] = 0; eCol[i * 3 + 2] = 0
        gPos[i * 3] = 0
        gPos[i * 3 + 1] = 0
        gPos[i * 3 + 2] = -999
        gCol[i * 3] = 0; gCol[i * 3 + 1] = 0; gCol[i * 3 + 2] = 0
      }
    }

    emberMat.size = opts.emberSize
    if (opts.fakeBloom) {
      emberMat.opacity = opts.fakeBloomEmberOpacity
    } else {
      emberMat.opacity = 0.6
    }
    glowMat.size = opts.glowSize
    glowMat.opacity = opts.glowOpacity
    trailGeo.attributes.position.needsUpdate = true
    trailGeo.attributes.color.needsUpdate = true
    emberGeo.attributes.position.needsUpdate = true
    emberGeo.attributes.color.needsUpdate = true
    glowGeo.attributes.position.needsUpdate = true
    glowGeo.attributes.color.needsUpdate = true
  }

  function reset() { killAll() }

  function dispose() {
    trailGeo.dispose()
    trailMat.dispose()
    emberGeo.dispose()
    emberMat.dispose()
    glowGeo.dispose()
    glowMat.dispose()
  }

  return { update, reset, dispose }
}

// --- Core glow subsystem ---

function createCoreSystem(state, opts, glowTex, portalGroup) {
  const corePositions = new Float32Array(CORE_COUNT * 3)
  const coreGeo = new THREE.BufferGeometry()
  coreGeo.setAttribute('position', new THREE.BufferAttribute(corePositions, 3))
  const coreMat = new THREE.PointsMaterial({
    map: glowTex, color: 0xee8811, size: opts.coreSize,
    transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const coreParticles = new THREE.Points(coreGeo, coreMat)
  coreParticles.frustumCulled = false
  portalGroup.add(coreParticles)

  // Glow halo layer (fake bloom for iOS)
  const coreGlowPositions = new Float32Array(CORE_COUNT * 3)
  const coreGlowGeo = new THREE.BufferGeometry()
  coreGlowGeo.setAttribute('position', new THREE.BufferAttribute(coreGlowPositions, 3))
  const coreGlowMat = new THREE.PointsMaterial({
    map: glowTex, color: 0xee8833, size: opts.coreGlowSize,
    transparent: true, opacity: opts.coreGlowOpacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const coreGlowMesh = new THREE.Points(coreGlowGeo, coreGlowMat)
  coreGlowMesh.frustumCulled = false
  portalGroup.add(coreGlowMesh)

  function update(t) {
    coreParticles.visible = opts.core
    coreGlowMesh.visible = opts.fakeBloom && opts.core
    if (!opts.core) return

    const cPos = coreGeo.attributes.position.array
    if (state.phase === 0) {
      // no-op
    } else if (state.phase === 1 || state.phase === 3) {
      coreParticles.rotation.z = 0
      coreGlowMesh.rotation.z = 0
      for (let i = 0; i < CORE_COUNT; i++) {
        if (state.arcProgress < 0.01) {
          cPos[i * 3 + 2] = -999
        } else {
          const angle = (state.arcStart ?? DEFAULT_ARC_START) + Math.random() * state.arcProgress
          const r = RING_RADIUS + (Math.random() - 0.5) * 0.06
          cPos[i * 3] = Math.cos(angle) * r
          cPos[i * 3 + 1] = Math.sin(angle) * r
          cPos[i * 3 + 2] = (Math.random() - 0.5) * 0.05
        }
      }
      coreGeo.attributes.position.needsUpdate = true
    } else {
      if (state.coreNeedsFullCircle) {
        state.coreNeedsFullCircle = false
        for (let i = 0; i < CORE_COUNT; i++) {
          const angle = Math.random() * Math.PI * 2
          const r = RING_RADIUS + (Math.random() - 0.5) * 0.06
          cPos[i * 3] = Math.cos(angle) * r
          cPos[i * 3 + 1] = Math.sin(angle) * r
          cPos[i * 3 + 2] = (Math.random() - 0.5) * 0.05
        }
        coreGeo.attributes.position.needsUpdate = true
      }
      coreParticles.rotation.z = t * opts.ringSpeed
      coreGlowMesh.rotation.z = t * opts.ringSpeed
    }
    coreMat.size = opts.coreSize
    if (opts.fakeBloom) {
      coreMat.opacity = opts.fakeBloomCoreOpacity
      const cgPos = coreGlowGeo.attributes.position.array
      for (let i = 0; i < CORE_COUNT; i++) {
        cgPos[i * 3] = cPos[i * 3]
        cgPos[i * 3 + 1] = cPos[i * 3 + 1]
        cgPos[i * 3 + 2] = cPos[i * 3 + 2] - 0.001
      }
      coreGlowGeo.attributes.position.needsUpdate = true
    } else {
      coreMat.color.setHex(0xee8811)
      coreMat.opacity = 0.7
    }
    coreGlowMat.size = opts.coreGlowSize
    coreGlowMat.opacity = opts.coreGlowOpacity
  }

  function reset() {
    const cPos = coreGeo.attributes.position.array
    const cgPos = coreGlowGeo.attributes.position.array
    for (let i = 0; i < CORE_COUNT; i++) {
      cPos[i * 3] = 0
      cPos[i * 3 + 1] = 0
      cPos[i * 3 + 2] = -999
      cgPos[i * 3] = 0
      cgPos[i * 3 + 1] = 0
      cgPos[i * 3 + 2] = -999
    }
    coreGeo.attributes.position.needsUpdate = true
    coreGlowGeo.attributes.position.needsUpdate = true
    coreParticles.rotation.z = 0
    coreGlowMesh.rotation.z = 0
  }

  function dispose() {
    coreGeo.dispose()
    coreMat.dispose()
    coreGlowGeo.dispose()
    coreGlowMat.dispose()
  }

  reset()

  return { update, reset, dispose }
}

// --- Haze subsystem ---

function createHazeSystem(state, opts, portalGroup) {
  const hazeSize = 256

  function makeHazeTex(stops) {
    const c = document.createElement('canvas')
    c.width = hazeSize; c.height = hazeSize
    const ctx = c.getContext('2d')
    const cx = hazeSize / 2
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
    for (const [s, col] of stops) g.addColorStop(s, col)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, hazeSize, hazeSize)
    return new THREE.CanvasTexture(c)
  }

  // Original gradient (matches presentation — tuned for real bloom)
  const realHazeTex = makeHazeTex([
    [0, 'rgba(0, 0, 0, 0)'],
    [0.35, 'rgba(60, 8, 0, 0)'],
    [0.52, 'rgba(120, 25, 2, 0.2)'],
    [0.65, 'rgba(80, 12, 0, 0.12)'],
    [0.85, 'rgba(40, 5, 0, 0.04)'],
    [1, 'rgba(0, 0, 0, 0)'],
  ])

  // Wider, more diffuse gradient (tuned for fake bloom on iOS)
  const fakeHazeTex = makeHazeTex([
    [0, 'rgba(0, 0, 0, 0)'],
    [0.22, 'rgba(50, 8, 0, 0.05)'],
    [0.34, 'rgba(100, 20, 1, 0.15)'],
    [0.46, 'rgba(130, 30, 2, 0.25)'],
    [0.56, 'rgba(100, 20, 1, 0.18)'],
    [0.68, 'rgba(70, 12, 0, 0.10)'],
    [0.82, 'rgba(40, 5, 0, 0.04)'],
    [1, 'rgba(0, 0, 0, 0)'],
  ])

  const REAL_SCALE = 4.0, FAKE_SCALE = 5.0
  const REAL_SOFT = 0.5, FAKE_SOFT = 0.8

  const uniforms = {
    map: { value: opts.fakeBloom ? fakeHazeTex : realHazeTex },
    uArcStart: { value: DEFAULT_ARC_START },
    uArcProgress: { value: 0.0 },
    uSoftEdge: { value: opts.fakeBloom ? FAKE_SOFT : REAL_SOFT },
    uIntensity: { value: 1.0 },
  }
  const hazeMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uArcStart;
      uniform float uArcProgress;
      uniform float uSoftEdge;
      uniform float uIntensity;
      varying vec2 vUv;

      #define TAU 6.2831853

      void main() {
        vec4 tex = texture2D(map, vUv);

        vec2 centered = vUv - 0.5;
        float angle = atan(centered.y, centered.x);
        float rel = mod(angle - uArcStart + TAU, TAU);

        if (uArcProgress >= TAU) {
          gl_FragColor = tex * uIntensity;
          return;
        }

        float distToStart = rel;
        float distToEnd = uArcProgress - rel;
        float gapToStart = TAU - rel;

        float nearestDist = distToEnd >= 0.0
          ? min(distToStart, distToEnd)
          : -min(-distToEnd, gapToStart);

        float bleed = uSoftEdge * 0.6;
        float arcMask = smoothstep(-bleed, bleed * 0.4, nearestDist);

        float fullness = smoothstep(TAU - uSoftEdge * 2.0, TAU, uArcProgress);
        float mask = mix(arcMask, 1.0, fullness);

        gl_FragColor = tex * mask * uIntensity;
      }
    `,
  })
  const hazeGeo = new THREE.PlaneGeometry(1, 1)
  const hazeMesh = new THREE.Mesh(hazeGeo, hazeMat)
  hazeMesh.scale.setScalar(opts.fakeBloom ? FAKE_SCALE : REAL_SCALE)
  hazeMesh.position.z = -0.1
  hazeMesh.visible = false
  portalGroup.add(hazeMesh)

  function update() {
    if (opts.haze && state.phase !== 0) {
      hazeMesh.visible = true
      uniforms.uArcStart.value = state.arcStart ?? DEFAULT_ARC_START
      uniforms.uArcProgress.value = state.arcProgress
    } else {
      hazeMesh.visible = false
    }
    // Swap haze config based on current mode
    if (opts.fakeBloom) {
      uniforms.map.value = fakeHazeTex
      uniforms.uSoftEdge.value = FAKE_SOFT
      hazeMesh.scale.setScalar(FAKE_SCALE)
    } else {
      uniforms.map.value = realHazeTex
      uniforms.uSoftEdge.value = REAL_SOFT
      hazeMesh.scale.setScalar(REAL_SCALE)
    }
    uniforms.uIntensity.value = opts.hazeIntensity * (opts.fakeBloom ? opts.hazeBoost : 1.0)
  }

  function reset() {
    hazeMesh.visible = false
    uniforms.uArcProgress.value = 0.0
  }

  function dispose() {
    hazeGeo.dispose()
    realHazeTex.dispose()
    fakeHazeTex.dispose()
    hazeMat.dispose()
  }

  return { update, reset, dispose }
}

// --- Main factory ---

export function createPortalScene(state, opts) {
  let renderer = null
  let composer = null
  let bloomPass = null
  let portalGroup = null
  let animationId = 0
  let glowTex = null
  let sparks = null
  let core = null
  let haze = null
  let camera = null
  let dpr = 1
  const fov = 50
  const visualDiameter = 3.0

  function init(el, w, h) {
    if (renderer) return

    dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2)
    const scene = new THREE.Scene()
    const aspect = w / h
    camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100)
    camera.position.z = visualDiameter * h / (2 * opts.ringSize * Math.tan((fov / 2) * Math.PI / 180))

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false })
    renderer.setSize(w, h)
    renderer.setPixelRatio(dpr)
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.LinearToneMapping
    renderer.toneMappingExposure = 1.0
    el.appendChild(renderer.domElement)

    const renderTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: 0,
    })
    composer = new EffectComposer(renderer, renderTarget)
    composer.addPass(new RenderPass(scene, camera))
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w * dpr, h * dpr),
      opts.bloomStrength,
      opts.bloomRadius,
      opts.bloomThreshold,
    )
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    portalGroup = new THREE.Group()
    scene.add(portalGroup)

    glowTex = createGlowTexture()
    sparks = createSparkSystem(state, opts, glowTex, portalGroup)
    core = createCoreSystem(state, opts, glowTex, portalGroup)
    haze = createHazeSystem(state, opts, portalGroup)

    let lastTime = performance.now() * 0.001

    function animate() {
      const t = performance.now() * 0.001
      const dt = Math.min(t - lastTime, 0.05)
      lastTime = t

      core.update(t)
      haze.update()
      sparks.update(dt, t)

      bloomPass.strength = opts.bloomStrength
      bloomPass.radius = opts.bloomRadius
      bloomPass.threshold = opts.bloomThreshold

      if (opts.bloom) {
        composer.render()
      } else {
        renderer.render(scene, camera)
      }
      animationId = requestAnimationFrame(animate)
    }

    animate()
  }

  function resetVisuals() {
    sparks?.reset()
    core?.reset()
    haze?.reset()
  }

  function resize(w, h) {
    if (!renderer || !camera) return
    camera.aspect = w / h
    camera.position.z = visualDiameter * h / (2 * opts.ringSize * Math.tan((fov / 2) * Math.PI / 180))
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }

  function resizeComposer(w, h) {
    if (composer) {
      composer.setSize(w * dpr, h * dpr)
    }
    if (bloomPass) {
      bloomPass.resolution.set(w * dpr, h * dpr)
    }
  }

  function dispose() {
    if (animationId) cancelAnimationFrame(animationId)
    animationId = 0
    sparks?.dispose()
    core?.dispose()
    haze?.dispose()
    sparks = null
    core = null
    haze = null
    glowTex?.dispose()
    glowTex = null
    bloomPass?.dispose()
    bloomPass = null
    if (composer) { composer.dispose(); composer = null }
    if (renderer) { renderer.dispose(); renderer.domElement.remove(); renderer = null }
    portalGroup = null
  }

  function getPortalGroup() { return portalGroup }
  function getRenderer() { return renderer }

  return { init, resize, resizeComposer, resetVisuals, dispose, getPortalGroup, getRenderer }
}

// Vue composable wrapper for Slidev (same API as before)
export function usePortalScene(state, opts) {
  return createPortalScene(state, opts)
}
