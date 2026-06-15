/* =========================================================================
   SolarSpeculations - index.html Engine
   p5.js (Rendering/Entities/Trajektorien) + Tone.js (Ambient/Reverb-Busse)
   Inhalt liegt komplett in data/*.json - dieser Code rendert nur.
   Laeuft auch ohne Assets: fehlende Bilder -> Platzhalter-Form, fehlende
   Sounds -> Stille.
   ========================================================================= */

// ---- globaler Zustand --------------------------------------------------
let scenesData = null;
let entitiesData = null;
let scenes = [];          // Szenen inkl. geladenem Hintergrundbild
let allEntities = [];     // alle Entity-Instanzen
let currentScene = 0;
let nextScene = -1;       // Ziel waehrend Crossfade, sonst -1
let sceneFade = 1;        // 0..1 Crossfade-Fortschritt zur neuen Szene
const SCENE_FADE_SPEED = 0.6; // pro Sekunde

let started = false;      // Audio-Geste erfolgt?
let openEntity = null;    // aktuell geoeffnetes Inhalts-Panel
let hoverEntity = null;
let heldEntity = null;    // Entity, das gerade per Maus festgehalten/gedreht wird
let globeBuf = null;      // gemeinsamer WebGL-Layer fuer 3D-Kugeln
let oceanShader = null;   // Shader fuer animierte Meeresstroemungen
let cloudShader = null;   // Shader fuer prozedurale, animierte Wolken
const GLOBE_BUF = 600;    // Aufloesung dieses Layers (px)
const GLOBE_R_FRAC = 0.37; // sphere(R)-Radius als Anteil von GLOBE_BUF
let globeProjFrac = null;  // tatsaechlich projizierter Kugelradius-Anteil (zur Laufzeit gemessen)

// ===== FOTO-GLOBUS-SHADER (echte Satellitentextur, beleuchtet) =====
// Albedo (earth_day) + Normal-Map (Relief) + Specular (Ozean-Glanz) + Wasser-Gain (heller,
// Struktur bleibt) + breiter Wasser-Schimmer + gerichtetes Sonnenlicht + Tag/Nacht-Terminator
// + Atmosphaeren-Fresnel-Rand. Beleuchtung im MODELLRAUM via uLight/uCam (toModelVec).
const SURF_VERT = `
precision highp float;
attribute vec3 aPosition; attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix, uProjectionMatrix;
varying vec2 vUv; varying vec3 vModelPos; varying vec3 vN0;
void main(){ vUv=aTexCoord; vModelPos=aPosition; vN0=normalize(aPosition);
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition,1.0); }`;

const SURF_FRAG = `
precision highp float;
varying vec2 vUv; varying vec3 vModelPos; varying vec3 vN0;
uniform sampler2D uDay, uNormalMap, uSpec;
uniform vec3 uLight, uCam, uSunCol, uNightCol, uAtmoCol;
uniform float uRelief, uGloss, uSpecGain, uAmbient, uWaterGain, uSheen, uSheenPow;
void main(){
  vec3 N0 = normalize(vN0);
  vec3 T = normalize(vec3(N0.z, 0.0, -N0.x) + vec3(1e-5));
  vec3 B = cross(N0, T);
  vec3 nm = texture2D(uNormalMap, vUv).rgb * 2.0 - 1.0;
  vec3 N = normalize(N0 + (T*nm.x + B*nm.y) * uRelief);
  vec3 L = normalize(uLight);
  vec3 Vd = normalize(uCam - vModelPos);
  vec3 alb = texture2D(uDay, vUv).rgb;
  float spec = texture2D(uSpec, vUv).r;
  alb *= mix(1.0, uWaterGain, spec);                         // Wasser verstaerken -> heller + Struktur
  float diff = max(dot(N, L), 0.0);
  float term = smoothstep(-0.12, 0.22, dot(N0, L));          // Tag/Nacht-Kante
  vec3 Hh = normalize(L + Vd);
  float sp = pow(max(dot(N, Hh), 0.0), uGloss) * spec * uSpecGain * term;   // (uSpecGain=0 -> kein Hotspot)
  vec3 dayCol = alb * (uAmbient + diff) * uSunCol + sp * uSunCol;
  vec3 nightCol = alb * uNightCol;                           // dunkle Nachtseite, keine Lichter
  vec3 col = mix(nightCol, dayCol, term);
  float sheen = pow(max(dot(N, Hh), 0.0), uSheenPow) * spec * term * uSheen;   // dezenter breiter Schimmer
  col += sheen * vec3(0.70, 0.80, 1.00);
  float fres = pow(1.0 - max(dot(N0, Vd), 0.0), 3.0);        // Atmosphaeren-Rand
  col += uAtmoCol * fres * (0.18 + 0.82 * term);
  gl_FragColor = vec4(col, 1.0);
}`;

// Wolken: PROZEDURAL (animiertes 3D-Noise), dynamisch (Drift+Morph ueber uTime), Land-Maske via
// Specular (ueber Land hoehere Schwelle + schwaecher), Pol-Fade. WICHTIG: p5 blendMode(BLEND)
// ist PREMULTIPLIED -> vormultipliziert ausgeben (ccol*al, al), sonst bei Bedeckung opak weiss.
const CLOUD_VERT = SURF_VERT;
const CLOUD_FRAG = `
precision highp float;
varying vec2 vUv; varying vec3 vModelPos; varying vec3 vN0;
uniform sampler2D uLandSpec;
uniform vec3 uLight, uCam;
uniform float uCloudOp, uTime;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0.,0.,0.)),hash(i+vec3(1.,0.,0.)),u.x),mix(hash(i+vec3(0.,1.,0.)),hash(i+vec3(1.,1.,0.)),u.x),u.y),
             mix(mix(hash(i+vec3(0.,0.,1.)),hash(i+vec3(1.,0.,1.)),u.x),mix(hash(i+vec3(0.,1.,1.)),hash(i+vec3(1.,1.,1.)),u.x),u.y),u.z); }
float fbm(vec3 p){ float v=0.0,a=0.5; for(int k=0;k<5;k++){ v+=a*vnoise(p); p*=2.0; a*=0.5; } return v; }
void main(){
  vec3 N0 = normalize(vN0);
  vec3 L = normalize(uLight);
  vec3 Vd = normalize(uCam - vModelPos);
  float water = texture2D(uLandSpec, vUv).r;                 // hoch=Wasser, niedrig=Land
  float t = uTime;
  float ca = cos(t*0.010), sa = sin(t*0.010);
  vec3 d = vec3(N0.x*ca + N0.z*sa, N0.y, -N0.x*sa + N0.z*ca); // Drift
  float base = fbm(d*2.6 + vec3(0.0, t*0.012, 0.0)) * 0.5 + 0.5;
  float det  = fbm(d*7.0 + 11.0) * 0.5 + 0.5;
  float raw = base*0.70 + det*0.30;
  float pole = 1.0 - smoothstep(0.80, 0.99, abs(N0.y));
  float lo = mix(0.82, 0.74, water);                         // hohe Schwelle -> wenige Wolken
  float a = smoothstep(lo, lo + 0.11, raw) * pole;
  a *= clamp(det*0.6 + 0.5, 0.0, 1.0);
  if(a < 0.01) discard;
  float term = smoothstep(-0.05, 0.28, dot(N0, L));
  vec3 ccol = mix(vec3(0.55,0.60,0.68), vec3(1.0), 0.3 + 0.7*term);
  float rim = smoothstep(0.0, 0.22, dot(N0, Vd));
  float landScale = mix(0.30, 1.0, water);
  float al = a * (0.10 + 0.90*term) * rim * landScale * uCloudOp;
  gl_FragColor = vec4(ccol * al, al);                        // VORMULTIPLIZIERT
}`;

function ensureGlobeBuffer() {
  if (!globeBuf) {
    globeBuf = createGraphics(GLOBE_BUF, GLOBE_BUF, WEBGL);
    oceanShader = globeBuf.createShader(SURF_VERT, SURF_FRAG);
    cloudShader = globeBuf.createShader(CLOUD_VERT, CLOUD_FRAG);
  }
}

// ---- Foto-Globus: Beleuchtungs-Tuning (Werte aus globereal.html, von Lukas freigegeben) ----
const SUN_WORLD   = [0.55, 0.30, 0.78];   // Weltrichtung zur Sonne: ueberwiegend frontal -> meist Tagseite
const G_SUNCOL    = [1.0, 0.97, 0.90];
const G_NIGHTCOL  = [0.04, 0.05, 0.09];   // dunkle Nachtseite (keine Stadtlichter)
const G_ATMOCOL   = [0.42, 0.60, 0.95];   // Atmosphaeren-Blau am Rand
const G_RELIEF    = 0.85;
const G_GLOSS     = 240.0;                 // enger Glanz
const G_SPECGAIN  = 0.0;                   // Sonnen-Hotspot AUS
const G_AMBIENT   = 0.20;
const G_WATER_GAIN = 2.0;                  // Wasser heller + Struktur
const G_SHEEN      = 0.14;                 // dezenter breiter Wasser-Schimmer
const G_SHEEN_POW  = 7.0;
const G_CLOUD_OP   = 0.50;                 // Wolken-Deckkraft (premultiplied)

function norm3(v){ const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/m, v[1]/m, v[2]/m]; }
// Weltvektor -> Modellsystem der Kugel: Rx(-tilt) dann Ry(-spin). Fuer Licht UND Kamera,
// damit Beleuchtung/Glanz/Schimmer korrekt liegen, waehrend sich die Kugel dreht.
function toModelVec(v, tilt, spin) {
  let L = v.slice();
  let a = -tilt, c = Math.cos(a), s = Math.sin(a); L = [L[0], L[1]*c - L[2]*s, L[1]*s + L[2]*c];
  a = -spin; c = Math.cos(a); s = Math.sin(a);      L = [L[0]*c + L[2]*s, L[1], -L[0]*s + L[2]*c];
  return L;
}

// rendert die FOTO-Kugel: Albedo + Normal-Relief + Specular + Sonnenlicht + Tag/Nacht + Atmosphaere
// (Oberflaechen-Shader), darueber prozedurale dynamische Wolken (eigene, leicht groessere Kugel).
function drawGlobe(ent) {
  const g = globeBuf;
  const R = GLOBE_BUF * GLOBE_R_FRAC;
  const camZ = (GLOBE_BUF / 2) / Math.tan(Math.PI / 6);   // p5-Default-Kamera des Buffers
  g.clear();
  const gl = g.drawingContext;
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  const tNow = millis() / 1000;
  const tilt = ent.tilt, spin = ent.spinAngle;
  const L = toModelVec(norm3(SUN_WORLD), tilt, spin);   // Sonne im Modellraum
  const cam = toModelVec([0, 0, camZ], tilt, spin);     // Kamera im Modellraum

  // Oberflaeche
  g.push();
  g.noStroke();
  if (oceanShader && ent.normTex && ent.specTex) {
    g.shader(oceanShader);
    oceanShader.setUniform('uDay', ent.tex);
    oceanShader.setUniform('uNormalMap', ent.normTex);
    oceanShader.setUniform('uSpec', ent.specTex);
    oceanShader.setUniform('uLight', L); oceanShader.setUniform('uCam', cam);
    oceanShader.setUniform('uSunCol', G_SUNCOL); oceanShader.setUniform('uNightCol', G_NIGHTCOL);
    oceanShader.setUniform('uAtmoCol', G_ATMOCOL);
    oceanShader.setUniform('uRelief', G_RELIEF); oceanShader.setUniform('uGloss', G_GLOSS);
    oceanShader.setUniform('uSpecGain', G_SPECGAIN); oceanShader.setUniform('uAmbient', G_AMBIENT);
    oceanShader.setUniform('uWaterGain', G_WATER_GAIN);
    oceanShader.setUniform('uSheen', G_SHEEN); oceanShader.setUniform('uSheenPow', G_SHEEN_POW);
  } else {
    g.noLights(); g.texture(ent.tex);
  }
  g.rotateX(tilt);
  g.rotateY(spin);
  g.sphere(R, 96, 64);
  g.pop();
  if (oceanShader) g.resetShader();

  // projizierten OBERFLAECHEN-Radius messen (vor der groesseren Wolkenkugel) -> Halo
  if (globeProjFrac === null) {
    const cx = GLOBE_BUF / 2, cyy = GLOBE_BUF / 2;
    let r = GLOBE_BUF / 2;
    for (let x = cx; x < GLOBE_BUF; x++) { if (g.get(x, cyy)[3] < 10) { r = x - cx; break; } }
    globeProjFrac = r / GLOBE_BUF;
  }

  // Wolken: prozedural, dynamisch (Drift+Morph via uTime), leicht groessere Kugel.
  // Backface-Culling (nur vordere Halbkugel) + kein Tiefenschreiben + PREMULTIPLIED Alpha.
  if (cloudShader && ent.specTex) {
    g.blendMode(BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.depthMask(false);
    g.push();
    g.noStroke();
    g.shader(cloudShader);
    cloudShader.setUniform('uLandSpec', ent.specTex);
    cloudShader.setUniform('uLight', L); cloudShader.setUniform('uCam', cam);
    cloudShader.setUniform('uCloudOp', G_CLOUD_OP);
    cloudShader.setUniform('uTime', tNow);                 // Wolken driften unabhaengig vom Spin
    g.rotateX(tilt);
    g.rotateY(spin);
    g.sphere(R * 1.012, 96, 64);                   // schwebt knapp ueber der Oberflaeche
    g.pop();
    g.resetShader();
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
  }
}
let duck = 0;             // 0..1 Audio-Ducking + Bewegungs-Verlangsamung bei offenem Panel

let audio = null;         // Tone-Graph

// =========================================================================
//  DATEN LADEN
// =========================================================================
async function loadData() {
  const [s, e] = await Promise.all([
    fetch('data/scenes.json').then(r => r.json()),
    fetch('data/entities.json').then(r => r.json())
  ]);
  scenesData = s;
  entitiesData = e;
}

// Bild laden mit Fallback (fehlt die Datei -> img bleibt null -> Platzhalter)
function tryLoadImage(path) {
  return new Promise(resolve => {
    if (!path) { resolve(null); return; }
    loadImage(path, img => resolve(img), () => resolve(null));
  });
}

async function buildWorld() {
  // Szenen + Hintergruende
  scenes = [];
  for (const sc of scenesData.scenes) {
    const bg = await tryLoadImage(sc.background);
    scenes.push({ ...sc, bg });
  }
  // Entities
  allEntities = [];
  for (const def of entitiesData.entities) {
    const img = await tryLoadImage(def.image);
    const ent = new Entity(def, img);
    if (def.frames) ent.frames = await loadFrames(def.frames);  // Animations-Sequenz
    if (def.globe) {
      ent.tex = await tryLoadImage(def.globe.texture);
      if (def.globe.normal) ent.normTex = await tryLoadImage(def.globe.normal);
      if (def.globe.spec) ent.specTex = await tryLoadImage(def.globe.spec);
      ensureGlobeBuffer();
    }
    allEntities.push(ent);
  }
}

// Frame-Sequenz laden (z.B. rotierender Globus): frames = { dir, count, fps, pad }
async function loadFrames(spec) {
  const ps = [];
  for (let i = 0; i < spec.count; i++) {
    const n = String(i).padStart(spec.pad || 2, '0');
    ps.push(tryLoadImage(spec.dir + 'frame_' + n + '.png'));
  }
  return (await Promise.all(ps)).filter(Boolean);
}

// =========================================================================
//  ENTITY
// =========================================================================
class Entity {
  constructor(def, img) {
    this.def = def;
    this.img = img;
    this.frames = null;               // optionale Animations-Sequenz
    this.spinTime = 0;                // akkumulierte Dreh-Zeit (pausierbar)
    // 3D-Kugel (WebGL): freie Drehung mit Schwung
    this.isGlobe = !!def.globe;
    if (this.isGlobe) {
      this.tex = null; this.normTex = null; this.specTex = null;
      this.baseVel = def.globe.baseVel != null ? def.globe.baseVel : 0.3;  // rad/s Normaltempo
      this.tilt = def.globe.tilt != null ? def.globe.tilt : 0.35;
      this.cloudVel = def.globe.cloudDrift != null ? def.globe.cloudDrift : 0.05;  // Wolken-Eigendrift
      this.spinAngle = 0;
      this.spinVel = this.baseVel;
      this.tiltVel = 0;            // Pitch-Schwung (Hoch/Runter-Drehung)
      this.cloudDrift = 0;
    }
    this.path = def.path || [{ x: 0.5, y: 0.5 }];
    this.loop = def.loop || 'loop';
    this.closed = this.loop === 'loop' && this.path.length > 2;
    this.u = Math.random() * 0.6;     // Startposition gestreut
    this.dir = 1;                      // fuer pingpong
    this.respawnAlpha = 1;            // fuer drift-Ein-/Ausblenden
    this.bobPhase = Math.random() * TWO_PI;
    this.highlight = 0;               // 0..1 weiches Hervorheben beim Klick
    this.color = colorFromId(def.id); // Platzhalterfarbe
    this.pos = { x: 0, y: 0 };        // letzte Bildschirmposition (px)
    this.radius = 40;
  }

  update(dt) {
    // Bewegung verlangsamt sich, wenn ein Panel offen ist
    const slow = 1 - 0.85 * duck;
    const step = (this.def.speed || 0.03) * dt * slow;

    if (this.path.length > 1) {
      this.u += step * this.dir;
      if (this.loop === 'pingpong') {
        if (this.u > 1) { this.u = 1; this.dir = -1; }
        if (this.u < 0) { this.u = 0; this.dir = 1; }
      } else if (this.loop === 'drift') {
        // einmal durchlaufen, dann am Anfang neu auftauchen (mit Fade)
        if (this.u > 1) { this.u = 0; this.respawnAlpha = 0; }
        this.respawnAlpha = min(1, this.respawnAlpha + dt * 0.8);
        if (this.u > 0.9) this.respawnAlpha = max(0, (1 - this.u) / 0.1);
      } else { // loop
        this.u = (this.u % 1 + 1) % 1;
      }
    }
    this.bobPhase += dt * 1.4;

    // Drehung der Frame-Sequenz laeuft weiter, solange nicht festgehalten
    if (this.frames && this.frames.length && heldEntity !== this) this.spinTime += dt;

    // 3D-Kugel: dreht von selbst; Schwung klingt sanft auf Normaltempo ab
    if (this.isGlobe) {
      if (heldEntity !== this) {
        // Yaw (links/rechts): klingt auf Normaltempo ab
        this.spinAngle += this.spinVel * dt;
        this.spinVel += (this.baseVel - this.spinVel) * Math.min(1, dt * 1.2);
        // Pitch (hoch/runter): Schwung klingt auf 0 ab -> Neigung bleibt stehen, wo losgelassen
        this.tilt += this.tiltVel * dt;
        this.tiltVel += (0 - this.tiltVel) * Math.min(1, dt * 1.2);
      }
      this.cloudDrift += this.cloudVel * dt;   // Wolken ziehen immer (auch im Stillstand)
    }

    const target = this.highlight > 0 && openEntity === this ? 1 : 0;
    this.highlight += (target - this.highlight) * min(1, dt * 4);
  }

  // normierte Position (0..1) entlang des Pfades
  normPos() {
    const p = pointAt(this.path, this.u, this.closed);
    const bob = (this.def.bob || 0) * Math.sin(this.bobPhase);
    return { x: p.x, y: p.y + bob };
  }

  draw() {
    const np = this.normPos();
    const x = np.x * width;
    const y = np.y * height;
    const sz = (this.def.scale || 0.12) * Math.min(width, height) * 2;
    this.pos = { x, y };
    this.radius = sz * 0.5;

    let alpha = (this.def.opacity != null ? this.def.opacity : 1) * this.respawnAlpha;
    alpha *= currentSceneAlphaFor(this);

    push();
    translate(x, y);
    const glow = 0.15 + this.highlight * 0.5 + (hoverEntity === this ? 0.2 : 0);

    // 3D-Kugel: WebGL-Layer rendern, Atmosphaeren-Halo dahinter, Kugel-Bild, Tag/Nacht-Schatten
    let handled = false;
    if (this.isGlobe && this.tex && globeBuf) {
      drawGlobe(this);
      const ctx = drawingContext, r = sz * (globeProjFrac || GLOBE_R_FRAC);
      // weicher Atmosphaeren-Halo (ragt ueber den Kugelrand hinaus, hinter der Kugel)
      let halo = ctx.createRadialGradient(0, 0, r * 0.82, 0, 0, r * 1.35);
      halo.addColorStop(0, 'rgba(130,175,235,0)');
      halo.addColorStop(0.42, `rgba(130,175,235,${0.45 * alpha})`);
      halo.addColorStop(1, 'rgba(130,175,235,0)');
      ctx.fillStyle = halo; ctx.fillRect(-r * 1.5, -r * 1.5, r * 3, r * 3);
      // Kugel-Bild
      imageMode(CENTER);
      tint(255, 255 * alpha);
      image(globeBuf, 0, 0, sz, sz);
      noTint();
      // Tag/Nacht-Kante + Atmosphaeren-Rand laufen jetzt IM Shader (kein 2D-Overlay noetig).
      handled = true;
    }

    // aktuelles Bild: bei Frame-Sequenz das laufende Einzelbild, sonst das Standbild
    let drawImg = handled ? null : this.img;
    if (!handled && this.frames && this.frames.length) {
      const fps = (this.def.frames && this.def.frames.fps) || 12;
      const idx = Math.floor(this.spinTime * fps) % this.frames.length;
      drawImg = this.frames[idx];
    }

    if (drawImg) {
      // weicher Schein bei Hover/Highlight
      if (glow > 0.16) {
        drawingContext.shadowBlur = 40 * glow;
        drawingContext.shadowColor = `rgba(216,178,90,${0.6 * glow})`;
      }
      imageMode(CENTER);
      tint(255, 255 * alpha);
      const ratio = drawImg.height / drawImg.width;
      image(drawImg, 0, 0, sz, sz * ratio);
      drawingContext.shadowBlur = 0;
    } else if (!handled) {
      // Platzhalter-Form: weicher Leuchtkleks
      noStroke();
      const c = this.color;
      for (let i = 3; i >= 0; i--) {
        const r = sz * 0.5 * (0.5 + i * 0.22);
        fill(c[0], c[1], c[2], alpha * (10 + glow * 30) * (4 - i));
        ellipse(0, 0, r * 2);
      }
      fill(c[0], c[1], c[2], alpha * 220);
      ellipse(0, 0, sz * 0.42);
      fill(255, alpha * 60);
      ellipse(-sz * 0.08, -sz * 0.08, sz * 0.14);
    }
    pop();

    // Hover-Label
    if (hoverEntity === this && alpha > 0.4) {
      push();
      textAlign(CENTER, BOTTOM);
      textSize(14);
      const ty = y - this.radius - 10;
      noStroke();
      fill(255, 225); rect(x - textWidth(this.def.label) / 2 - 8, ty - 20, textWidth(this.def.label) + 16, 24, 3);
      fill(20, 20, 20, 255 * Math.min(1, glow * 3 + 0.5));
      text(this.def.label, x, ty);
      pop();
    }
  }

  contains(mx, my) {
    return dist(mx, my, this.pos.x, this.pos.y) < this.radius * 0.7;
  }
}

// =========================================================================
//  PFAD-INTERPOLATION (Catmull-Rom fuer weiche Kurven)
// =========================================================================
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function pointAt(pts, p, closed) {
  const n = pts.length;
  if (n === 1) return { x: pts[0].x, y: pts[0].y };
  if (n === 2) return { x: lerp(pts[0].x, pts[1].x, p), y: lerp(pts[0].y, pts[1].y, p) };
  const segs = closed ? n : n - 1;
  let fp = p * segs;
  let i = Math.floor(fp);
  let t = fp - i;
  if (closed) { i = ((i % segs) + segs) % segs; }
  else { if (i >= segs) { i = segs - 1; t = 1; } if (i < 0) { i = 0; t = 0; } }
  const idx = k => closed ? ((k % n) + n) % n : Math.max(0, Math.min(n - 1, k));
  const a = pts[idx(i - 1)], b = pts[idx(i)], c = pts[idx(i + 1)], d = pts[idx(i + 2)];
  return { x: catmull(a.x, b.x, c.x, d.x, t), y: catmull(a.y, b.y, c.y, d.y, t) };
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  // in p5-RGB umwandeln (HSL grob)
  const c = hslToRgb(h, 0.5, 0.6);
  return c;
}
function hslToRgb(h, s, l) {
  h /= 360; let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// =========================================================================
//  SZENEN-CROSSFADE-HELFER
// =========================================================================
// Sichtbarkeits-Alpha eines Entitys abhaengig vom aktuellen Crossfade
function currentSceneAlphaFor(ent) {
  const curId = scenes[currentScene]?.id;
  const nxtId = nextScene >= 0 ? scenes[nextScene]?.id : null;
  if (ent.def.scene === curId && ent.def.scene === nxtId) return 1;
  if (ent.def.scene === curId) return 1 - sceneFadeT();
  if (ent.def.scene === nxtId) return sceneFadeT();
  return 0;
}
function sceneFadeT() { return nextScene >= 0 ? sceneFade : 0; }

// =========================================================================
//  AUDIO (Tone.js) - drei geteilte Reverb-Busse, szenenbezogenes Routing
// =========================================================================
function buildAudio() {
  const master = new Tone.Volume(0).toDestination();

  // Drei geteilte Reverb-Busse (kurz/lang/riesig) - NICHT pro Sound!
  const makeBus = decay => {
    const r = new Tone.Reverb({ decay, wet: 1 });
    r.connect(master);
    return r;
  };
  const buses = { short: makeBus(3), long: makeBus(10), huge: makeBus(16) };

  audio = { master, buses, players: {}, ducker: master };

  // pro Szene einen Ambient-Player anlegen (lazy: nur wenn Datei existiert)
  for (const sc of scenesData.scenes) {
    if (!sc.ambient) continue;
    const vol = new Tone.Volume(-60).connect(master); // startet stumm
    const send = sc.reverbSend && buses[sc.reverbSend.bus]
      ? new Tone.Gain(sc.reverbSend.amount || 0.3) : null;
    if (send) send.connect(buses[sc.reverbSend.bus]);

    const player = new Tone.Player({
      url: sc.ambient,
      loop: true,
      fadeIn: 1, fadeOut: 1,
      onerror: () => { audio.players[sc.id] = null; } // Datei fehlt -> Stille
    });
    player.connect(vol);
    if (send) player.connect(send);
    audio.players[sc.id] = { player, vol, baseVol: sc.ambientVolume != null ? sc.ambientVolume : -12 };
  }
}

function playSceneAudio(index, fadeSec = 2) {
  if (!audio) return;
  scenes.forEach((sc, i) => {
    const slot = audio.players[sc.id];
    if (!slot) return;
    const target = i === index ? slot.baseVol : -60;
    try {
      if (i === index && slot.player.loaded && slot.player.state !== 'started') slot.player.start();
      slot.vol.volume.rampTo(target, fadeSec);
    } catch (e) { /* Player evtl. noch nicht geladen */ }
  });
}

function setDuck(on) {
  if (!audio) return;
  audio.master.volume.rampTo(on ? -9 : 0, on ? 0.4 : 0.9);
}

// =========================================================================
//  p5 LIFECYCLE
// =========================================================================
// Viewport-Maße robust ermitteln (windowWidth ist in manchen Umgebungen 0)
function vw() { return window.innerWidth || windowWidth || document.documentElement.clientWidth; }
function vh() { return window.innerHeight || windowHeight || document.documentElement.clientHeight; }

function setup() {
  const c = createCanvas(vw(), vh());
  c.parent('canvas-holder');
  imageMode(CENTER);
  textFont('Georgia');
  noLoop(); // erst nach Datenladen + Geste loopen

  loadData()
    .then(buildWorld)
    .then(() => {
      buildNav();
      document.getElementById('status').style.display = 'none';
      const gate = document.getElementById('gate');
      gate.classList.remove('hidden');
      gate.addEventListener('click', startExperience, { once: true });
    })
    .catch(err => {
      document.getElementById('status').textContent = 'Fehler beim Laden: ' + err.message;
      console.error(err);
    });
}

async function startExperience() {
  await Tone.start();
  buildAudio();
  started = true;
  document.getElementById('gate').classList.add('hidden');
  updateSceneName();
  // kleine Verzoegerung, damit Reverb-Impulse generiert sind
  setTimeout(() => playSceneAudio(currentScene, 3), 200);
  loop();
}

function draw() {
  const dt = Math.min(0.05, deltaTime / 1000); // s, gedeckelt gegen Tab-Sprung
  const base = hexToRgb(scenes[currentScene]?.backgroundTint || '#ffffff');
  background(base[0], base[1], base[2]);

  // Hintergruende (mit Crossfade)
  drawBackground(currentScene, nextScene >= 0 ? 1 - sceneFade : 1);
  if (nextScene >= 0) drawBackground(nextScene, sceneFade);

  // Crossfade fortschreiben
  if (nextScene >= 0) {
    sceneFade = Math.min(1, sceneFade + dt * SCENE_FADE_SPEED);
    if (sceneFade >= 1) {
      currentScene = nextScene;
      nextScene = -1;
      sceneFade = 1;
    }
  }

  // Ducking-Wert weich nachfuehren
  const duckTarget = openEntity ? 1 : 0;
  duck += (duckTarget - duck) * Math.min(1, dt * 4);

  // Entities aktualisieren + zeichnen (nur sichtbare Szenen)
  hoverEntity = null;
  for (const ent of allEntities) {
    if (currentSceneAlphaFor(ent) <= 0.01) continue;
    ent.update(dt);
  }
  // Hover-Erkennung (oberstes zuerst)
  for (let i = allEntities.length - 1; i >= 0; i--) {
    const ent = allEntities[i];
    if (currentSceneAlphaFor(ent) > 0.4 && ent.contains(mouseX, mouseY)) { hoverEntity = ent; break; }
  }
  for (const ent of allEntities) {
    if (currentSceneAlphaFor(ent) <= 0.01) continue;
    ent.draw();
  }

  if (heldEntity) cursor('grabbing');
  else if (hoverEntity) cursor((hoverEntity.frames || hoverEntity.isGlobe) ? 'grab' : 'pointer');
  else cursor('default');
}

function drawBackground(index, alpha) {
  const sc = scenes[index];
  if (!sc) return;
  push();
  if (sc.bg) {
    // bildschirmfuellend (cover)
    const ir = sc.bg.width / sc.bg.height;
    const cr = width / height;
    let w, h;
    if (ir > cr) { h = height; w = height * ir; } else { w = width; h = width / ir; }
    tint(255, 255 * alpha);
    image(sc.bg, width / 2, height / 2, w, h);
  } else {
    // einfarbiger Hintergrund aus backgroundTint
    const tintCol = hexToRgb(sc.backgroundTint || '#ffffff');
    noStroke();
    fill(tintCol[0], tintCol[1], tintCol[2], 255 * alpha);
    rect(0, 0, width, height);
  }
  pop();
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [parseInt(m.substr(0, 2), 16), parseInt(m.substr(2, 2), 16), parseInt(m.substr(4, 2), 16)];
}

// =========================================================================
//  INTERAKTION
// =========================================================================
function mousePressed() {
  if (!started || openEntity) return;
  for (let i = allEntities.length - 1; i >= 0; i--) {
    const ent = allEntities[i];
    if (currentSceneAlphaFor(ent) > 0.4 && ent.contains(mouseX, mouseY)) {
      // 3D-Kugel: greifen (Drehung anhalten, dann per Ziehen steuern)
      if (ent.isGlobe) { heldEntity = ent; ent.spinVel = 0; ent.tiltVel = 0; }
      // Frame-Sequenz: Halten pausiert
      else if (ent.frames && ent.frames.length) heldEntity = ent;
      else openPanel(ent);
      return;
    }
  }
}

// Ziehen dreht die gegriffene Kugel nach links/rechts; Tempo merkt sie sich als Schwung
function mouseDragged() {
  if (heldEntity && heldEntity.isGlobe) {
    const ent = heldEntity;
    const k = 1.3 / Math.max(ent.radius, 1);
    const dYaw = (mouseX - pmouseX) * k;     // horizontal -> links/rechts
    const dPit = (mouseY - pmouseY) * k;     // vertikal   -> hoch/runter
    ent.spinAngle += dYaw;
    ent.tilt += dPit;
    const dtc = Math.max(deltaTime / 1000, 0.001);
    ent.spinVel = dYaw / dtc;                // Schwung fuers Loslassen (beide Achsen)
    ent.tiltVel = dPit / dtc;
  }
}

function mouseReleased() { heldEntity = null; }   // Loslassen -> Schwung, dann zurueck auf Normaltempo

function openPanel(ent) {
  openEntity = ent;
  const c = ent.def.content || {};
  document.getElementById('panel-title').textContent = c.title || ent.def.label || '';
  document.getElementById('panel-body').textContent = c.body || '';
  const sec = document.getElementById('panel-secondary');
  if (c.secondaryImage) { sec.src = c.secondaryImage; sec.style.display = 'block'; }
  else { sec.style.display = 'none'; }
  const link = document.getElementById('panel-link');
  if (c.link && c.link.url) { link.href = c.link.url; link.textContent = c.link.label || 'mehr'; link.style.display = 'inline-block'; }
  else { link.style.display = 'none'; }
  document.getElementById('panel').classList.add('open');
  setDuck(true);
}

function closePanel() {
  openEntity = null;
  document.getElementById('panel').classList.remove('open');
  setDuck(false);
}

// =========================================================================
//  SZENEN-NAVIGATION
// =========================================================================
function goToScene(index) {
  if (index === currentScene || nextScene >= 0) return;
  if (index < 0 || index >= scenes.length) return;
  nextScene = index;
  sceneFade = 0;
  updateDots(index);
  updateSceneName(index);
  if (started) playSceneAudio(index, 3);
}

function buildNav() {
  const dots = document.getElementById('dots');
  dots.innerHTML = '';
  scenes.forEach((sc, i) => {
    const d = document.createElement('div');
    d.className = 'dot' + (i === currentScene ? ' active' : '');
    d.title = sc.name;
    d.addEventListener('click', () => goToScene(i));
    dots.appendChild(d);
  });
  document.getElementById('prev').addEventListener('click', () => goToScene((currentScene - 1 + scenes.length) % scenes.length));
  document.getElementById('next').addEventListener('click', () => goToScene((currentScene + 1) % scenes.length));
  document.getElementById('panel-close').addEventListener('click', closePanel);
  updateSceneName();
}

function updateDots(index) {
  document.querySelectorAll('#dots .dot').forEach((d, i) => d.classList.toggle('active', i === index));
}
function updateSceneName(index = currentScene) {
  const sc = scenes[index];
  if (sc) document.getElementById('scene-name').textContent = sc.name || '';
}

function keyPressed() {
  if (keyCode === ESCAPE && openEntity) closePanel();
  else if (keyCode === LEFT_ARROW) goToScene((currentScene - 1 + scenes.length) % scenes.length);
  else if (keyCode === RIGHT_ARROW) goToScene((currentScene + 1) % scenes.length);
}

function windowResized() { resizeCanvas(vw(), vh()); }
