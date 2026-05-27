"use client";

import React, { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// --- Premium Procedural Geometries (Centered at 0,0,0) ---

function getSpawnPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Scatter across screen-space: moderate X and Y, shallow Z to prevent them from being too spread out
    const x = (Math.random() - 0.5) * 40;
    const y = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 20 - 5;
    points[i*3] = x;
    points[i*3+1] = y;
    points[i*3+2] = z;
  }
  return points;
}

function getDataCorePoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    if (r < 0.15) {
      // Inner Dense Nucleus
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const rad = Math.cbrt(Math.random()) * 0.4;
      points[i*3] = rad * Math.sin(phi) * Math.cos(theta);
      points[i*3+1] = rad * Math.sin(phi) * Math.sin(theta);
      points[i*3+2] = rad * Math.cos(phi);
    } else if (r < 0.35) {
      // Outer Spherical Shell
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const rad = 0.9 + (Math.random() * 0.05);
      points[i*3] = rad * Math.sin(phi) * Math.cos(theta);
      points[i*3+1] = rad * Math.sin(phi) * Math.sin(theta);
      points[i*3+2] = rad * Math.cos(phi);
    } else {
      // Omni-Directional Orbital Rings
      const ringId = Math.floor(Math.random() * 12);
      const theta = Math.random() * Math.PI * 2;
      const rad = 1.3 + (ringId % 4) * 0.25 + (Math.random() * 0.05);
      
      const bx = Math.cos(theta) * rad;
      const by = Math.sin(theta) * rad;
      const bz = (Math.random() - 0.5) * 0.15;
      
      const rotX = (ringId * 13.1) % (Math.PI * 2);
      const rotY = (ringId * 7.7) % (Math.PI * 2);
      const rotZ = (ringId * 19.3) % (Math.PI * 2);
      
      const y1 = by * Math.cos(rotX) - bz * Math.sin(rotX);
      const z1 = by * Math.sin(rotX) + bz * Math.cos(rotX);
      const x2 = bx * Math.cos(rotY) + z1 * Math.sin(rotY);
      const z2 = -bx * Math.sin(rotY) + z1 * Math.cos(rotY);
      const x3 = x2 * Math.cos(rotZ) - y1 * Math.sin(rotZ);
      const y3 = x2 * Math.sin(rotZ) + y1 * Math.cos(rotZ);
      
      points[i*3] = x3;
      points[i*3+1] = y3;
      points[i*3+2] = z2;
    }
  }
  return points;
}

function getDNAPoints(count: number) {
  const points = new Float32Array(count * 3);
  const height = 11.0;
  const radius = 2.0;
  const turns = 2.5;
  const numSteps = 40; // Horizontal rungs

  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const t = Math.random() - 0.5; // -0.5 to 0.5 (bottom to top)
    const y = t * height;
    const angle = t * Math.PI * 2 * turns;
    
    if (r < 0.3) {
      // Backbone 1
      const noiseX = (Math.random() - 0.5) * 0.3;
      const noiseZ = (Math.random() - 0.5) * 0.3;
      points[i*3] = Math.cos(angle) * radius + noiseX;
      points[i*3+1] = y + (Math.random() - 0.5) * 0.2;
      points[i*3+2] = Math.sin(angle) * radius + noiseZ;
    } else if (r < 0.6) {
      // Backbone 2 (180 degrees offset)
      const noiseX = (Math.random() - 0.5) * 0.3;
      const noiseZ = (Math.random() - 0.5) * 0.3;
      points[i*3] = Math.cos(angle + Math.PI) * radius + noiseX;
      points[i*3+1] = y + (Math.random() - 0.5) * 0.2;
      points[i*3+2] = Math.sin(angle + Math.PI) * radius + noiseZ;
    } else {
      // Connecting rungs
      const stepT = (Math.floor((t + 0.5) * numSteps) / numSteps) - 0.5;
      const stepY = stepT * height;
      const stepAngle = stepT * Math.PI * 2 * turns;
      
      const bridgeT = Math.random(); // 0 to 1 across the rung
      const x1 = Math.cos(stepAngle) * radius;
      const z1 = Math.sin(stepAngle) * radius;
      const x2 = Math.cos(stepAngle + Math.PI) * radius;
      const z2 = Math.sin(stepAngle + Math.PI) * radius;
      
      points[i*3] = x1 * (1 - bridgeT) + x2 * bridgeT + (Math.random() - 0.5) * 0.2;
      points[i*3+1] = stepY + (Math.random() - 0.5) * 0.2;
      points[i*3+2] = z1 * (1 - bridgeT) + z2 * bridgeT + (Math.random() - 0.5) * 0.2;
    }
    
    // Tilt the whole DNA strand slightly for a cinematic angle
    const tilt = Math.PI / 8;
    const px = points[i*3];
    const py = points[i*3+1];
    points[i*3] = px * Math.cos(tilt) - py * Math.sin(tilt);
    points[i*3+1] = px * Math.sin(tilt) + py * Math.cos(tilt);
  }
  return points;
}

function getJetPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let x = 0, y = 0, z = 0;
    
    if (r < 0.35) {
      // Fuselage: Cylinder with aerodynamic nose and tail cones
      const theta = Math.random() * Math.PI * 2;
      const t = Math.random(); // 0 (front) to 1 (back)
      const length = 7.0;
      z = (t - 0.5) * length;
      
      let radius = 0.4;
      if (t < 0.15) radius = 0.4 * Math.sin((t / 0.15) * (Math.PI / 2)); // Nose curve
      else if (t > 0.8) radius = 0.4 * Math.sin(((1.0 - t) / 0.2) * (Math.PI / 2)); // Tail curve
      
      x = Math.cos(theta) * radius;
      y = Math.sin(theta) * radius;
    } else if (r < 0.65) {
      // Main Wings: Classic swept-back commercial wings
      const side = Math.random() > 0.5 ? 1 : -1;
      const span = Math.random() * 4.0; // wing length
      const chord = 1.2 * (1.0 - span / 4.0) + Math.random() * 0.4; // tapers at end
      x = side * (0.3 + span);
      y = 0;
      z = -0.5 + span * 0.6 + (Math.random() - 0.5) * chord; // Swept back
    } else if (r < 0.8) {
      // Horizontal Stabilizers (Rear small wings)
      const side = Math.random() > 0.5 ? 1 : -1;
      const span = Math.random() * 1.5;
      x = side * (0.2 + span);
      y = 0;
      z = 2.8 + span * 0.5 + (Math.random() - 0.5) * 0.6;
    } else if (r < 0.9) {
      // Vertical Tail Fin
      const h = Math.random() * 1.8;
      x = 0;
      y = 0.3 + h;
      z = 2.8 + h * 0.6 + (Math.random() - 0.5) * 0.6;
    } else {
      // Under-wing Engines
      const side = Math.random() > 0.5 ? 1 : -1;
      const theta = Math.random() * Math.PI * 2;
      const rad = 0.18;
      x = side * 1.2 + Math.cos(theta) * rad;
      y = -0.2 + Math.sin(theta) * rad;
      z = 0.2 + (Math.random() - 0.5) * 0.8;
    }
    
    // Bank angle
    const bank = -Math.PI / 10;
    const bx = x * Math.cos(bank) - y * Math.sin(bank);
    const by = x * Math.sin(bank) + y * Math.cos(bank);

    points[i*3] = bx;
    points[i*3+1] = by;
    points[i*3+2] = z;
  }
  return points;
}

function getMicrochipPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let x, y, z;
    if (r < 0.3) {
      // Central Die (Raised)
      const s = 1.6;
      const face = Math.random();
      if (face < 0.2) { x = (Math.random()-0.5)*s; y = 0.4; z = (Math.random()-0.5)*s; }
      else if (face < 0.4) { x = (Math.random()-0.5)*s; y = Math.random()*0.4; z = s/2; }
      else if (face < 0.6) { x = (Math.random()-0.5)*s; y = Math.random()*0.4; z = -s/2; }
      else if (face < 0.8) { x = s/2; y = Math.random()*0.4; z = (Math.random()-0.5)*s; }
      else { x = -s/2; y = Math.random()*0.4; z = (Math.random()-0.5)*s; }
    } else if (r < 0.5) {
      // Flat Substrate base
      const s = 5.0;
      x = (Math.random() - 0.5) * s;
      y = 0;
      z = (Math.random() - 0.5) * s;
    } else {
      // Circuit Pins
      const s = 5.0;
      const side = Math.floor(Math.random() * 4);
      const pos = (Math.random() - 0.5) * s;
      const pinLength = Math.random() * 0.8 + 0.2;
      const pinDrop = Math.random() * 0.6;
      
      const part = Math.random();
      if (side === 0) { 
        if (part < 0.5) { x = pos; y = 0; z = -s/2 - pinLength * Math.random(); }
        else { x = pos; y = -pinDrop * Math.random(); z = -s/2 - pinLength; }
      } else if (side === 1) { 
        if (part < 0.5) { x = pos; y = 0; z = s/2 + pinLength * Math.random(); }
        else { x = pos; y = -pinDrop * Math.random(); z = s/2 + pinLength; }
      } else if (side === 2) { 
        if (part < 0.5) { x = s/2 + pinLength * Math.random(); y = 0; z = pos; }
        else { x = s/2 + pinLength; y = -pinDrop * Math.random(); z = pos; }
      } else { 
        if (part < 0.5) { x = -s/2 - pinLength * Math.random(); y = 0; z = pos; }
        else { x = -s/2 - pinLength; y = -pinDrop * Math.random(); z = pos; }
      }
    }
    
    // Isometric Tilt
    const ty = Math.PI / 4;
    const rx = x * Math.cos(ty) - z * Math.sin(ty);
    let rz = x * Math.sin(ty) + z * Math.cos(ty);
    
    const tx = Math.PI / 6;
    const ry = y * Math.cos(tx) - rz * Math.sin(tx);
    rz = y * Math.sin(tx) + rz * Math.cos(tx);

    points[i*3] = rx;
    points[i*3+1] = ry;
    points[i*3+2] = rz;
  }
  return points;
}

function getDataScatterPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Particles pushed far back in Z so they appear as 1-2 px ambient dots.
    // Spread wide in X/Y to create a sparse starfield behind the finding card.
    const x = (Math.random() - 0.5) * 40;
    const y = (Math.random() - 0.5) * 28;
    const z = -10 - Math.random() * 20; // Z: -10 to -30 in shape space
    points[i*3]   = x;
    points[i*3+1] = y;
    points[i*3+2] = z;
  }
  return points;
}

function getSilkWavePoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Generate an incredibly wide, deep plane
    const x = (Math.random() - 0.5) * 40; // Spread wide
    const z = (Math.random() - 0.5) * 30; // Spread deep
    
    // Baseline structural curve (adds volume to the flat plane)
    const y = Math.sin(x * 0.15) * 2.0 + Math.cos(z * 0.15) * 2.0;
    
    points[i * 3] = x;
    points[i * 3 + 1] = y - 4.0; // Offset down to sit behind the CTA button
    points[i * 3 + 2] = z;
  }
  return points;
}

// --- Custom GLSL Vertex Shader ---

const vertexShader = `
  attribute vec3 spawnPos;
  attribute vec3 position1;
  attribute vec3 position2;
  attribute vec3 position3;
  attribute vec3 position4;
  attribute vec3 position5;
  attribute vec3 position6;

  uniform float uTime;
  uniform float uProgress;
  uniform float uSpawnTime;
  uniform float uScale;
  uniform float uCoreScale;
  uniform float uMobile;
  uniform vec3 uOffsets[6];

// Hash & Noise
float hash(vec3 p) {
  p  = fract( p*0.3183099+.1 );
  p *= 17.0;
  return fract( p.x*p.y*p.z*(p.x+p.y+p.z) );
}

// Cheaper turbulence to replace expensive curl noise
vec3 cheapTurbulence(vec3 p) {
    float x = sin(p.y * 3.0) + cos(p.z * 2.0);
    float y = sin(p.z * 3.0) + cos(p.x * 2.0);
    float z = sin(p.x * 3.0) + cos(p.y * 2.0);
    return vec3(x, y, z) * 0.5;
}

void main() {
  // 1. Data Core: Rings orbit the center at different speeds.
  // Use the *unscaled* position to compute orbit distance so rotation speed
  // stays consistent across devices regardless of uCoreScale.
  vec3 p1 = position1 * uCoreScale;
  float dist1 = length(position1.xz);
  float angle1 = uTime * (0.4 / (dist1 + 0.5));
  float tmpX1 = p1.x * cos(angle1) - p1.z * sin(angle1);
  float tmpZ1 = p1.x * sin(angle1) + p1.z * cos(angle1);
  p1.x = tmpX1; p1.z = tmpZ1;

  // 2. DNA Helix: Majestic slow rotation around Y-axis
  vec3 p2 = position2 * uScale;
  float dnaAngle = uTime * 0.2;
  float tmpX2 = p2.x * cos(dnaAngle) - p2.z * sin(dnaAngle);
  float tmpZ2 = p2.x * sin(dnaAngle) + p2.z * cos(dnaAngle);
  p2.x = tmpX2; p2.z = tmpZ2;
  
  // 3. Jet: Smooth hover and thruster exhaust
  vec3 p3 = position3 * uScale;
  p3.y += sin(uTime * 1.5) * 0.3 * uScale;
  if (p3.z > 3.0 * uScale) {
      float thrusterIntensity = 0.15 * (1.0 - uMobile * 0.5);
      p3.x += (hash(p3 + uTime) - 0.5) * thrusterIntensity;
      p3.y += (hash(p3 + uTime + 1.0) - 0.5) * thrusterIntensity;
  }
  
  // 4. Microchip: Energy pulses.
  // Frequency uses unscaled position so the pulse pattern looks the same
  // at any uScale; amplitude (0.1 * uScale) tracks the shape's size.
  vec3 p4 = position4 * uScale;
  p4.y += max(0.0, sin(position4.x * 4.0 + position4.z * 4.0 - uTime * 3.0)) * 0.1 * uScale;

  // 5. Data Scatter: deep-Z ambient field — tiny ambient dots behind the finding card.
  vec3 p5 = position5 * uScale;
  p5.y += sin(position5.x * 0.4 + uTime * 0.25) * 0.12 * uScale;

  // 6. Silk Wave: ocean-like undulation for the CTA.
  vec3 p6 = position6 * uScale;
  float waveIntensity = 1.0 - uMobile * 0.4;
  p6.y += (sin(position6.x * 0.3 + uTime * 0.6) * 1.2 + cos(position6.z * 0.4 + uTime * 0.4) * 0.8) * waveIntensity * uScale;

  // Apply world offsets
  vec3 w1 = p1 + uOffsets[0];
  vec3 w2 = p2 + uOffsets[1];
  vec3 w3 = p3 + uOffsets[2];
  vec3 w4 = p4 + uOffsets[3];
  vec3 w5 = p5 + uOffsets[4];
  vec3 w6 = p6 + uOffsets[5];

  // INTERPOLATION & TRANSITION
  vec3 target;
  
  // Use smoothstep to "linger" on fully formed objects, but widened (0.1 to 0.9) to make morphing slower and more fluid
  float t = fract(uProgress);
  float easedT = smoothstep(0.1, 0.9, t); 
  float transitionState = 0.0;
  
  if (uProgress < 1.0) {
    target = mix(w1, w2, easedT);
    transitionState = easedT;
  } else if (uProgress < 2.0) {
    target = mix(w2, w3, easedT);
    transitionState = easedT;
  } else if (uProgress < 3.0) {
    target = mix(w3, w4, easedT);
    transitionState = easedT;
  } else if (uProgress < 4.0) {
    target = mix(w4, w5, easedT);
    transitionState = easedT;
  } else {
    float lastT = smoothstep(0.1, 0.9, max(0.0, min(1.0, uProgress - 4.0)));
    target = mix(w5, w6, lastT);
    transitionState = lastT;
  }
  
  // Zero turbulence on mobile so each particle follows its exact interpolated path
  // (preset-path feel). Desktop keeps subtle turbulence for organic interest.
  float curlScale = mix(1.2, 0.0, uMobile);
  float noiseIntensity = sin(transitionState * 3.14159) * curlScale;
  vec3 curl = cheapTurbulence(target * 0.5 + vec3(0.0, uProgress * 2.0, uTime * 0.2)) * noiseIntensity;
  vec3 finalPos = target + curl;

  // SPAWN ANIMATION (Chaotic Coalescence)
  float spawnEase = 1.0 - pow(1.0 - uSpawnTime, 4.0);

  // Particles start fully scattered from the dedicated spawnPos buffer
  vec3 chaoticStart = spawnPos;

  // Reduce spawn scatter on mobile — keep entry tight so particles coalesce smoothly
  float spawnTurbulence = (1.0 - spawnEase) * mix(4.0, 0.5, uMobile);
  vec3 spawnCurl = cheapTurbulence(chaoticStart * 0.1 + uTime) * spawnTurbulence;
  chaoticStart += spawnCurl;
  
  finalPos = mix(chaoticStart, finalPos, spawnEase);
  
  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  
  // On mobile, suppress the noise-driven size jitter so all particles appear uniform
  float sizeNoiseMult = mix(1.0 + noiseIntensity * 0.3, 1.0, uMobile);
  gl_PointSize = max(1.0, (50.0 - uMobile * 20.0) / -mvPosition.z) * sizeNoiseMult * spawnEase;
}
`;

const fragmentShader = `
void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.3, dist) * 0.8;
  gl_FragColor = vec4(0.066, 0.066, 0.066, alpha); // #111111
}
`;

// --- The GPU Particle Swarm ---

const PARTICLE_COUNT_DESKTOP = 50000;
const PARTICLE_COUNT_MOBILE = 10000;

function ParticleSwarm() {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const { viewport, size } = useThree();

  const isMobile = size.width < 768;
  const PARTICLE_COUNT = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;
  const shapeScale = isMobile ? 0.32 : 1.0;
  const coreScale = isMobile ? 0.65 : 1.0;

  const mountTimeRef = useRef<number | null>(null);
  const smoothProgressRef = useRef(0);

  // Stable vh for offset math. On mobile Safari the canvas `<div class="fixed inset-0">`
  // resizes when the URL bar collapses/expands, which would otherwise teleport every
  // particle mid-scroll. Snapshot the value once on mount and never update it (a
  // rotation will fall slightly out of alignment until reload — acceptable trade for
  // smooth scroll on phones, where rotation mid-read is rare).
  const [stableVh] = useState(() => viewport.height);

  // Section anchors: scroll-Y position at which each of the 6 shapes is fully formed.
  // Computed from the actual DOM section centers — robust to any section being taller
  // than 100vh (e.g. the Sample Finding section with its big receipt card on mobile).
  // 6 entries → uProgress 0..5 interpolates between them.
  //
  // The vh used to center each section is captured at mount and only refreshed on
  // orientationchange / large width deltas; iOS Safari URL-bar resizes would
  // otherwise shift every anchor by ~30 px mid-scroll.
  const anchorsRef = useRef<number[] | null>(null);
  useEffect(() => {
    let lastWidth = window.innerWidth;
    let lastVh = window.innerHeight;

    const measure = () => {
      const sections = document.querySelectorAll("main section");
      if (sections.length < 6) {
        anchorsRef.current = null;
        return;
      }
      const next: number[] = [];
      for (let i = 0; i < 6; i++) {
        const el = sections[i] as HTMLElement;
        // First section anchored at 0 so the page-load state shows shape 0 fully formed.
        const anchor = i === 0
          ? 0
          : Math.max(0, el.offsetTop + el.offsetHeight / 2 - lastVh / 2);
        next.push(anchor);
      }
      // Monotonic guard in case a section's center precedes the previous one's.
      for (let i = 1; i < next.length; i++) {
        if (next[i] <= next[i - 1]) next[i] = next[i - 1] + lastVh * 0.5;
      }
      anchorsRef.current = next;
    };

    const onResize = () => {
      const w = window.innerWidth;
      // Re-measure only if width changed (orientation / desktop window resize),
      // ignoring vh-only deltas from iOS Safari URL-bar collapse.
      if (Math.abs(w - lastWidth) > 4) {
        lastWidth = w;
        lastVh = window.innerHeight;
      }
      measure();
    };

    measure();
    // Re-measure after layout settles (fonts, images, hydration).
    const t1 = window.setTimeout(measure, 250);
    const t2 = window.setTimeout(measure, 1500);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("load", measure, { once: true });
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Generate centered buffers
  const buffers = useMemo(() => ({
    spawn: getSpawnPoints(PARTICLE_COUNT),
    pos1: getDataCorePoints(PARTICLE_COUNT),
    pos2: getDNAPoints(PARTICLE_COUNT),
    pos3: getJetPoints(PARTICLE_COUNT),
    pos4: getMicrochipPoints(PARTICLE_COUNT),
    pos5: getDataScatterPoints(PARTICLE_COUNT),
    pos6: getSilkWavePoints(PARTICLE_COUNT),
  }), [PARTICLE_COUNT]);

  // Global spatial offsets in world units (three.js units). For each shape N,
  // the swarm is panned to bring its offset to world Y=0 when uProgress=N, so
  // shape N is centered when its anchor scroll-Y is reached. Offsets use the
  // stable vh so they don't reflow with the iOS URL bar.
  const offsets = useMemo(() => {
    const vh = stableVh;
    if (isMobile) {
      return [
        new THREE.Vector3(0, vh * 0.2, -1),            // 0: DataCore
        new THREE.Vector3(0, -vh + vh * 0.2, -1),      // 1: DNA
        new THREE.Vector3(0, -vh * 2 + vh * 0.2, -1),  // 2: Jet
        new THREE.Vector3(0, -vh * 3 - vh * 0.15, -1), // 3: Chip — pushed below top text
        new THREE.Vector3(0, -vh * 4, -1),              // 4: Scatter (finding card)
        new THREE.Vector3(0, -vh * 5 - 0.5, -1),       // 5: SilkWave (CTA)
      ];
    }
    return [
      new THREE.Vector3(3.0, 0, 0),            // 0: DataCore right
      new THREE.Vector3(2.5, -vh - 1.0, 0),    // 1: DNA right
      new THREE.Vector3(-2.5, -vh * 2, 0),     // 2: Jet left
      new THREE.Vector3(4.5, -vh * 3, 0),      // 3: Chip right
      new THREE.Vector3(0, -vh * 4, 0),        // 4: Scatter (finding card) center
      new THREE.Vector3(0, -vh * 5 - 0.5, 0), // 5: SilkWave (CTA) center
    ];
  }, [isMobile, stableVh]);

  const uniforms = useMemo(() => ({
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uSpawnTime: { value: 0 },
    uScale: { value: shapeScale },
    uCoreScale: { value: coreScale },
    uMobile: { value: isMobile ? 1.0 : 0.0 },
    uOffsets: { value: offsets }

  }), [offsets, shapeScale, coreScale, isMobile]);

  useFrame((state, delta) => {
    if (!shaderRef.current || !pointsRef.current) return;

    const time = state.clock.getElapsedTime();

    // Native scroll for zero-latency syncing; clamp negatives (Mac/iOS overscroll bounce).
    const scrollY = Math.max(0, window.scrollY);

    const spawnDuration = isMobile ? 1500 : 3000;
    if (mountTimeRef.current === null) {
      mountTimeRef.current = Date.now();
    }
    const elapsedSpawn = (Date.now() - mountTimeRef.current) / spawnDuration;

    // Anchor-based mapping: each shape is fully formed when the user reaches the
    // matching section's center. Linear interpolation between anchors gives a
    // section-locked feel that holds regardless of section heights (e.g. the
    // Sample Finding section on mobile is taller than 100vh; the CTA section is
    // 100vh; the previous vh-arithmetic mapping silently broke in that case).
    let uP: number;
    const anchors = anchorsRef.current;
    if (anchors && anchors.length === 6) {
      if (scrollY <= anchors[0]) {
        uP = 0;
      } else if (scrollY >= anchors[5]) {
        uP = 5;
      } else {
        // Find the segment [anchors[i], anchors[i+1]) containing scrollY.
        let seg = 0;
        for (let i = 0; i < 5; i++) {
          if (scrollY < anchors[i + 1]) { seg = i; break; }
        }
        const span = anchors[seg + 1] - anchors[seg];
        const local = span > 0 ? (scrollY - anchors[seg]) / span : 0;
        uP = seg + local;
      }
    } else {
      // Fallback while anchors are being measured (first paint, very short window).
      uP = Math.min(5, scrollY / window.innerHeight);
    }

    // Smoothing — keep just enough to absorb dropped frames, fast enough that
    // particles feel pinned to scroll. Time-constant ≈ 40ms at lambda=25.
    const lerpFactor = isMobile ? 1 - Math.exp(-25 * delta) : 1.0;
    smoothProgressRef.current += (uP - smoothProgressRef.current) * lerpFactor;

    const smoothed = smoothProgressRef.current;
    shaderRef.current.uniforms.uTime.value = time;
    shaderRef.current.uniforms.uProgress.value = smoothed;
    shaderRef.current.uniforms.uSpawnTime.value = Math.min(1.0, elapsedSpawn);

    // Pan tracks the same smoothed progress so pan + morph never desync.
    pointsRef.current.position.y = smoothed * stableVh;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.pos1, 3]} />
        <bufferAttribute attach="attributes-spawnPos" args={[buffers.spawn, 3]} />
        <bufferAttribute attach="attributes-position1" args={[buffers.pos1, 3]} />
        <bufferAttribute attach="attributes-position2" args={[buffers.pos2, 3]} />
        <bufferAttribute attach="attributes-position3" args={[buffers.pos3, 3]} />
        <bufferAttribute attach="attributes-position4" args={[buffers.pos4, 3]} />
        <bufferAttribute attach="attributes-position5" args={[buffers.pos5, 3]} />
        <bufferAttribute attach="attributes-position6" args={[buffers.pos6, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={shaderRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

/** Same GPU black-particle field as the homepage — fixed behind content. */
export function ParticleCanvas() {
  // Cap DPR at 1 on phones to cut fragment-shader fillrate on retina screens
  // — animation stays smooth at 60fps without visible quality loss for points.
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const dpr: [number, number] = isMobile ? [1, 1] : [1, 1.5];
  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0">
      <Canvas camera={{ position: [0, 0, 10], fov: 45 }} dpr={dpr}>
        <ambientLight intensity={1} />
        <ParticleSwarm />
      </Canvas>
    </div>
  );
}

// --- Docs: "Quantum Möbius Nexus" (Continuous infinite loop, calm but highly creative) ---

function getDocsSpawnPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 44;
    const y = (Math.random() - 0.5) * 36;
    const z = (Math.random() - 0.5) * 22 - 6;
    points[i * 3] = x;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = z;
  }
  return points;
}

/** Particles formed into a continuous Möbius strip — symbolizing infinite loops and data continuity. */
function getDocsMobiusPoints(count: number) {
  const points = new Float32Array(count * 3);
  const R = 8.0; // Main radius
  const r = 3.0; // Tube radius
  
  for (let i = 0; i < count; i++) {
    const u = Math.random() * Math.PI * 2; // Angle around the main loop
    const v = Math.random() * Math.PI * 2; // Angle around the tube
    
    // Add some thickness/volume to the surface
    const thickness = (Math.random() - 0.5) * 1.5;
    const currentR = r + thickness;

    // Möbius parametric equations
    const x = (R + currentR * Math.cos(v / 2)) * Math.cos(u);
    const y = (R + currentR * Math.cos(v / 2)) * Math.sin(u);
    const z = currentR * Math.sin(v / 2);

    // Add some organic noise to break up the math perfection slightly
    const noiseX = (Math.random() - 0.5) * 0.4;
    const noiseY = (Math.random() - 0.5) * 0.4;
    const noiseZ = (Math.random() - 0.5) * 0.4;

    // Tilt for dramatic framing
    const tiltX = Math.PI / 4;
    const tiltY = Math.PI / 6;

    // Apply tilts
    let px = x + noiseX;
    let py = y + noiseY;
    let pz = z + noiseZ;

    // Rot X
    const tx = px;
    const ty = py * Math.cos(tiltX) - pz * Math.sin(tiltX);
    const tz = py * Math.sin(tiltX) + pz * Math.cos(tiltX);

    // Rot Y
    px = tx * Math.cos(tiltY) + tz * Math.sin(tiltY);
    pz = -tx * Math.sin(tiltY) + tz * Math.cos(tiltY);
    py = ty;

    points[i * 3] = px;
    points[i * 3 + 1] = py;
    points[i * 3 + 2] = pz;
  }
  return points;
}

const docsVertexShader = `
attribute vec3 spawnPos;
attribute vec3 position;

uniform float uTime;
uniform float uSpawnTime;
uniform float uMobile;
uniform float uScroll;

float cheapNoise(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.543))) * 43758.5453);
}

void main() {
  vec3 p = position;

  float calm = 1.0 - uMobile * 0.35;

  // Gentle majestic rotation of the entire Möbius structure
  float rotSpeed = uTime * 0.05 * calm;
  float cx = p.x * cos(rotSpeed) - p.z * sin(rotSpeed);
  float cz = p.x * sin(rotSpeed) + p.z * cos(rotSpeed);
  p.x = cx;
  p.z = cz;

  // Breathing / pulsating effect
  float pulse = sin(uTime * 0.2 + length(p) * 0.1) * 0.2 * calm;
  p += normalize(p) * pulse;

  // Subtle fluid wave distortion across the structure
  p.y += sin(p.x * 0.2 + uTime * 0.15) * 0.6 * calm;
  p.x += cos(p.y * 0.3 + uTime * 0.1) * 0.4 * calm;

  p.y += uScroll * 0.015; // Drift upwards on scroll

  float spawnEase = 1.0 - pow(1.0 - uSpawnTime, 3.0);
  vec3 chaotic = spawnPos;
  float wobble = (1.0 - spawnEase) * 3.5;
  chaotic += vec3(
    (cheapNoise(chaotic + uTime) - 0.5) * wobble,
    (cheapNoise(chaotic.yxz + uTime * 0.7) - 0.5) * wobble,
    (cheapNoise(chaotic.zxy + uTime * 1.1) - 0.5) * wobble * 0.6
  );

  vec3 finalPos = mix(chaotic, p, spawnEase);

  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  
  // Dynamic sizing based on depth and pulse
  gl_PointSize = max(1.0, (40.0 - uMobile * 15.0) / -mvPosition.z) * (1.0 + pulse * 0.5) * spawnEase;
}
`;

const docsFragmentShader = `
void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  if (dist > 0.5) discard;
  // Glowing core with softer edges
  float alpha = smoothstep(0.5, 0.2, dist) * 0.65;
  gl_FragColor = vec4(0.08, 0.08, 0.09, alpha);
}
`;

const DOCS_PARTICLE_DESKTOP = 28000;
const DOCS_PARTICLE_MOBILE = 16000;

function DocsParticleSwarm() {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const isMobile = size.width < 768;
  const count = isMobile ? DOCS_PARTICLE_MOBILE : DOCS_PARTICLE_DESKTOP;
  const mountTimeRef = useRef<number | null>(null);

  const buffers = useMemo(
    () => ({
      spawn: getDocsSpawnPoints(count),
      mobius: getDocsMobiusPoints(count),
    }),
    [count],
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSpawnTime: { value: 0 },
      uMobile: { value: isMobile ? 1.0 : 0.0 },
      uScroll: { value: 0 },
    }),
    [isMobile],
  );

  useFrame((state) => {
    if (!shaderRef.current) return;
    const time = state.clock.getElapsedTime();
    const scrollY = Math.max(0, window.scrollY);
    const spawnDuration = isMobile ? 1500 : 2500;
    if (mountTimeRef.current === null) {
      mountTimeRef.current = Date.now();
    }
    const elapsedSpawn = (Date.now() - mountTimeRef.current) / spawnDuration;
    shaderRef.current.uniforms.uTime.value = time;
    shaderRef.current.uniforms.uSpawnTime.value = Math.min(1.0, elapsedSpawn);
    shaderRef.current.uniforms.uScroll.value = scrollY;
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.mobius, 3]} />
        <bufferAttribute attach="attributes-spawnPos" args={[buffers.spawn, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={shaderRef}
        vertexShader={docsVertexShader}
        fragmentShader={docsFragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

/** Majestic, rotating Möbius strip for /docs — symbolizes infinite discovery & optimization. */
export function DocsParticleCanvas() {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const dpr: [number, number] = isMobile ? [1, 1] : [1, 1.5];
  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0">
      <Canvas camera={{ position: [0, 0, 15], fov: 45 }} dpr={dpr}>
        <ambientLight intensity={1} />
        <DocsParticleSwarm />
      </Canvas>
    </div>
  );
}

// --- Auth: "Gateway Portal" (Used for Sign-In and Sign-Up) ---

function getAuthSpawnPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 40;
    const y = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 20 - 5;
    points[i * 3] = x;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = z;
  }
  return points;
}

function getAuthGatewayPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let x, y, z;

    if (r < 0.6) {
      // Main Gateway Ring (Torus)
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const R = 8.0; // Major radius
      const tubeR = 1.2 + Math.random() * 0.8; // Minor radius with variation
      
      x = (R + tubeR * Math.cos(v)) * Math.cos(u);
      y = (R + tubeR * Math.cos(v)) * Math.sin(u);
      z = tubeR * Math.sin(v);
    } else if (r < 0.85) {
      // Inner Event Horizon (Disc pulling inward)
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 6.5; 
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
      z = (Math.random() - 0.5) * 0.5;
    } else {
      // Energy beams streaming outward along Z-axis
      const angle = Math.random() * Math.PI * 2;
      const radius = 8.0 + Math.random() * 3.0;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
      z = (Math.random() - 0.5) * 12.0;
    }

    // Apply a dramatic cinematic tilt
    const tiltX = Math.PI / 4; 
    const tiltY = Math.PI / 6; 

    const ty = y * Math.cos(tiltX) - z * Math.sin(tiltX);
    const tz = y * Math.sin(tiltX) + z * Math.cos(tiltX);

    const fx = x * Math.cos(tiltY) + tz * Math.sin(tiltY);
    const fz = -x * Math.sin(tiltY) + tz * Math.cos(tiltY);

    points[i * 3] = fx;
    points[i * 3 + 1] = ty;
    points[i * 3 + 2] = fz;
  }
  return points;
}

const authVertexShader = `
attribute vec3 spawnPos;
attribute vec3 position;

uniform float uTime;
uniform float uSpawnTime;
uniform float uMobile;

float cheapNoise(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.543))) * 43758.5453);
}

void main() {
  vec3 p = position;
  float calm = 1.0 - uMobile * 0.4;

  // Majestic rotation of the portal
  float rotSpeed = uTime * 0.08 * calm;
  float cx = p.x * cos(rotSpeed) - p.z * sin(rotSpeed);
  float cz = p.x * sin(rotSpeed) + p.z * cos(rotSpeed);
  p.x = cx;
  p.z = cz;

  // Inner horizon pull effect
  float dist = length(p.xy);
  if (dist < 6.5) {
    // Pull particles towards center slightly over time
    float pull = sin(uTime * 0.5 + dist) * 0.1;
    p.x -= p.x * pull;
    p.y -= p.y * pull;
  }

  // Energy beams undulating
  if (abs(p.z) > 2.0) {
    p.z += sin(p.x * 0.5 + uTime * 2.0) * 0.5 * calm;
  }

  float spawnEase = 1.0 - pow(1.0 - uSpawnTime, 4.0);
  vec3 chaotic = spawnPos;
  
  // High turbulence during spawn
  float wobble = (1.0 - spawnEase) * 5.0;
  chaotic += vec3(
    (cheapNoise(chaotic + uTime) - 0.5) * wobble,
    (cheapNoise(chaotic.yxz + uTime * 0.8) - 0.5) * wobble,
    (cheapNoise(chaotic.zxy + uTime * 1.2) - 0.5) * wobble
  );

  vec3 finalPos = mix(chaotic, p, spawnEase);

  // Shift slightly to the right for layout balance, centered for mobile
  float offsetX = mix(3.0, 0.0, uMobile); 
  finalPos.x += offsetX;

  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  
  // Mobile: slightly larger points (27 vs 27) to compensate for fewer particles
  gl_PointSize = max(1.0, (45.0 - uMobile * 12.0) / -mvPosition.z) * spawnEase;
}
`;

const authFragmentShader = `
void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  if (dist > 0.5) discard;
  // Deep sharp particle
  float alpha = smoothstep(0.5, 0.2, dist) * 0.7;
  gl_FragColor = vec4(0.066, 0.066, 0.066, alpha); // #111111
}
`;

const AUTH_PARTICLE_DESKTOP = 35000;
const AUTH_PARTICLE_MOBILE = 15000;

function AuthParticleSwarm() {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const isMobile = size.width < 768;
  const count = isMobile ? AUTH_PARTICLE_MOBILE : AUTH_PARTICLE_DESKTOP;
  const mountTimeRef = useRef<number | null>(null);

  const buffers = useMemo(
    () => ({
      spawn: getAuthSpawnPoints(count),
      gateway: getAuthGatewayPoints(count),
    }),
    [count],
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSpawnTime: { value: 0 },
      uMobile: { value: isMobile ? 1.0 : 0.0 },
    }),
    [isMobile],
  );

  useFrame((state) => {
    if (!shaderRef.current) return;
    const time = state.clock.getElapsedTime();
    const spawnDuration = isMobile ? 1200 : 2000;
    if (mountTimeRef.current === null) {
      mountTimeRef.current = Date.now();
    }
    const elapsedSpawn = (Date.now() - mountTimeRef.current) / spawnDuration;
    shaderRef.current.uniforms.uTime.value = time;
    shaderRef.current.uniforms.uSpawnTime.value = Math.min(1.0, elapsedSpawn);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.gateway, 3]} />
        <bufferAttribute attach="attributes-spawnPos" args={[buffers.spawn, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={shaderRef}
        vertexShader={authVertexShader}
        fragmentShader={authFragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

/** Distinctive Gateway Portal for Auth flows */
export function AuthParticleCanvas() {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const dpr: [number, number] = isMobile ? [1, 1] : [1, 1.5];
  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0">
      <Canvas camera={{ position: [0, 0, 16], fov: 45 }} dpr={dpr}>
        <ambientLight intensity={1} />
        <AuthParticleSwarm />
      </Canvas>
    </div>
  );
}

import { MotionValue } from "framer-motion";

// --- Dashboard: "Live Audit" (Wireframe particles) ---

function getDashboardCloudPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    points[i*3] = (Math.random() - 0.5) * 20;
    points[i*3+1] = (Math.random() - 0.5) * 20;
    points[i*3+2] = (Math.random() - 0.5) * 10 - 2;
  }
  return points;
}

function getDashboardGridPoints(count: number) {
  const points = new Float32Array(count * 3);
  const size = 12.0;
  const step = 2.0;
  for (let i = 0; i < count; i++) {
    const x = Math.round((Math.random() - 0.5) * size / step) * step;
    const y = Math.round((Math.random() - 0.5) * size / step) * step;
    const z = Math.round((Math.random() - 0.5) * (size/2) / step) * step;
    
    const noise = 0.1;
    points[i*3] = x + (Math.random()-0.5)*noise;
    points[i*3+1] = y + (Math.random()-0.5)*noise;
    points[i*3+2] = z + (Math.random()-0.5)*noise;
  }
  return points;
}

function getDashboardFunnelPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const angle = Math.random() * Math.PI * 2 + t * 10;
    
    const y = (0.5 - t) * 15;
    const r = Math.pow(1.0 - t, 2) * 8 + 0.5;
    
    points[i*3] = Math.cos(angle) * r;
    points[i*3+1] = y;
    points[i*3+2] = Math.sin(angle) * r;
  }
  return points;
}

function getDashboardSplitPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const y = (0.5 - t) * 15;
    
    let x = 0;
    const side = Math.random() > 0.5 ? 1 : -1;
    if (t > 0.3) {
      const splitT = (t - 0.3) / 0.7;
      x = Math.pow(splitT, 1.5) * 6 * side;
    }
    
    const noise = 0.4;
    points[i*3] = x + (Math.random()-0.5)*noise;
    points[i*3+1] = y;
    points[i*3+2] = (Math.random()-0.5)*noise;
  }
  return points;
}

function getDashboardGrowthPoints(count: number) {
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const x = (t - 0.5) * 15;
    const y = Math.pow(t, 3) * 15 - 5;
    
    const noise = 0.5;
    points[i*3] = x + (Math.random()-0.5)*noise;
    points[i*3+1] = y + (Math.random()-0.5)*noise;
    points[i*3+2] = (Math.random()-0.5)*noise;
  }
  return points;
}

const dashboardVertexShader = `
  attribute vec3 spawnPos;
  attribute vec3 position1;
  attribute vec3 position2;
  attribute vec3 position3;
  attribute vec3 position4;
  attribute vec3 position5;

  uniform float uTime;
  uniform float uProgress;
  uniform float uSpawnTime;
  uniform float uMobile;
  uniform vec3 uOffsets[5];

float cheapNoise(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.543))) * 43758.5453);
}

vec3 cheapTurbulence(vec3 p) {
    float x = sin(p.y * 3.0) + cos(p.z * 2.0);
    float y = sin(p.z * 3.0) + cos(p.x * 2.0);
    float z = sin(p.x * 3.0) + cos(p.y * 2.0);
    return vec3(x, y, z) * 0.5;
}

void main() {
  vec3 p1 = position1;
  
  vec3 p2 = position2;
  float a2 = uTime * 0.1;
  p2.xz = vec2(p2.x*cos(a2)-p2.z*sin(a2), p2.x*sin(a2)+p2.z*cos(a2));

  vec3 p3 = position3;
  float a3 = uTime * 1.5;
  p3.xz = vec2(p3.x*cos(a3)-p3.z*sin(a3), p3.x*sin(a3)+p3.z*cos(a3));

  vec3 p4 = position4;
  p4.y -= uTime * 2.0;
  p4.y = mod(p4.y + 7.5, 15.0) - 7.5;

  vec3 p5 = position5;
  float flowT = mod(p5.x + uTime * 4.0 + 7.5, 15.0) / 15.0;
  p5.x = (flowT - 0.5) * 15.0;
  p5.y = pow(flowT, 3.0) * 15.0 - 5.0;

  // We DO NOT offset vertically anymore because they stay sticky in center.
  // We offset horizontally to fit in the right side container on desktop.
  vec3 offsetDesktop = vec3(4.0, 0, 0);
  vec3 offsetMobile = vec3(0, 0, 0);
  vec3 posOffset = mix(offsetDesktop, offsetMobile, uMobile);

  vec3 target;
  float t = fract(uProgress);
  float easedT = smoothstep(0.2, 0.8, t);
  
  if (uProgress < 1.0) { target = mix(p1, p2, easedT); }
  else if (uProgress < 2.0) { target = mix(p2, p3, easedT); }
  else if (uProgress < 3.0) { target = mix(p3, p4, easedT); }
  else {
    float lastT = smoothstep(0.2, 0.8, max(0.0, min(1.0, uProgress - 3.0)));
    target = mix(p4, p5, lastT);
  }
  
  // Apply the same offset to all to keep it centered
  target += posOffset;

  // Keep morph turbulence gentle on mobile — shapes are small so world-unit chaos looks large
  float morphChaos = sin(easedT * 3.14159) * mix(2.0, 0.4, uMobile);
  target += cheapTurbulence(target + uTime) * morphChaos;

  float spawnEase = 1.0 - pow(1.0 - uSpawnTime, 4.0);
  float dashSpawnChaos = mix(10.0, 3.0, uMobile);
  vec3 chaotic = spawnPos + cheapTurbulence(spawnPos * 0.1 + uTime) * dashSpawnChaos * (1.0 - spawnEase);
  vec3 finalPos = mix(chaotic, target, spawnEase);
  
  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  
  // Larger size so they are more visible
  gl_PointSize = max(1.0, (50.0 - uMobile * 15.0) / -mvPosition.z) * spawnEase;
}
`;

const dashboardFragmentShader = `
void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  if (dist > 0.5) discard;
  // Make particles much darker and more opaque
  float alpha = smoothstep(0.5, 0.2, dist) * 0.95;
  gl_FragColor = vec4(0.066, 0.066, 0.066, alpha);
}
`;

const DASHBOARD_PARTICLE_DESKTOP = 45000;
const DASHBOARD_PARTICLE_MOBILE = 18000;

function DashboardParticleSwarm({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const isMobile = size.width < 768;
  const count = isMobile ? DASHBOARD_PARTICLE_MOBILE : DASHBOARD_PARTICLE_DESKTOP;
  const mountTimeRef = useRef<number | null>(null);

  const buffers = useMemo(() => ({
    spawn: getDashboardCloudPoints(count),
    pos1: getDashboardCloudPoints(count),
    pos2: getDashboardGridPoints(count),
    pos3: getDashboardFunnelPoints(count),
    pos4: getDashboardSplitPoints(count),
    pos5: getDashboardGrowthPoints(count)
  }), [count]);

  const uniforms = useMemo(() => ({
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uSpawnTime: { value: 0 },
    uMobile: { value: isMobile ? 1.0 : 0.0 },
    uOffsets: { value: [] } // unused now
  }), [isMobile]);

  useFrame((state) => {
    if (!shaderRef.current) return;
    const time = state.clock.getElapsedTime();
    const progress = scrollYProgress.get();
    
    const spawnDuration = isMobile ? 1500 : 3000;
    if (mountTimeRef.current === null) mountTimeRef.current = Date.now();
    const elapsedSpawn = (Date.now() - mountTimeRef.current) / spawnDuration;
    
    shaderRef.current.uniforms.uTime.value = time;
    shaderRef.current.uniforms.uProgress.value = progress * 4.0;
    shaderRef.current.uniforms.uSpawnTime.value = Math.min(1.0, elapsedSpawn);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-spawnPos" args={[buffers.spawn, 3]} />
        <bufferAttribute attach="attributes-position1" args={[buffers.pos1, 3]} />
        <bufferAttribute attach="attributes-position2" args={[buffers.pos2, 3]} />
        <bufferAttribute attach="attributes-position3" args={[buffers.pos3, 3]} />
        <bufferAttribute attach="attributes-position4" args={[buffers.pos4, 3]} />
        <bufferAttribute attach="attributes-position5" args={[buffers.pos5, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={shaderRef}
        vertexShader={dashboardVertexShader}
        fragmentShader={dashboardFragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

export function DashboardParticleCanvas({ scrollYProgress }: { scrollYProgress: MotionValue<number> }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const dpr: [number, number] = isMobile ? [1, 1] : [1, 1.5];
  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0">
      <Canvas camera={{ position: [0, 0, 15], fov: 45 }} dpr={dpr}>
        <ambientLight intensity={1} />
        <DashboardParticleSwarm scrollYProgress={scrollYProgress} />
      </Canvas>
    </div>
  );
}
