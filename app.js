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
  const L = toModelVec(currentSunWorld(), tilt, spin);   // Sonne im Modellraum (folgt der kreisenden Sonne)
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
    if (def.variants) { ent.variants = await loadVariants(def.variants); ent.pickVariant(); }  // Bild-Varianten-Ordner
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

// Variant-Ordner laden (Bild-Sprites). Wie loadFrames eine NUMMERIERTE Sequenz, aber mit Abbruch
// bei der ersten Luecke. Dateinamen-Praefix = Ordnername: ".../whale/" -> whale1.png, whale2.png, ...
// Faellt auf bare 1.png, 2.png zurueck, falls keine Praefix-Datei existiert. Max ~12 Varianten.
// Leeres Ergebnis -> Entity bleibt beim prozeduralen Platzhalter.
async function loadVariants(folder) {
  const name = folder.replace(/\/+$/, '').split('/').pop();   // Ordnername als Praefix
  let imgs = await loadVariantSeq(folder, name);              // erst <name>1.png, <name>2.png, ...
  if (!imgs.length) imgs = await loadVariantSeq(folder, '');  // sonst bare 1.png, 2.png, ...
  return imgs;
}
async function loadVariantSeq(folder, prefix) {
  const imgs = [];
  for (let i = 1; i <= 12; i++) {
    const img = await tryLoadImage(folder + prefix + i + '.png');
    if (!img) break;                                          // erste fehlende Nummer -> Sequenz-Ende
    imgs.push(img);
  }
  return imgs;
}

// =========================================================================
//  ENTITY
// =========================================================================
class Entity {
  constructor(def, img) {
    this.def = def;
    this.img = img;
    this.frames = null;               // optionale Animations-Sequenz
    this.variants = null;             // optionaler Ordner mit Bild-Varianten (zufaellig gewaehlt)
    this.spinTime = 0;                // akkumulierte Dreh-Zeit (pausierbar)
    // 3D-Kugel (WebGL): freie Drehung mit Schwung
    this.isGlobe = !!def.globe;
    if (this.isGlobe) {
      this.tex = null; this.normTex = null; this.specTex = null;
      this.baseVel = def.globe.baseVel != null ? def.globe.baseVel : 0.3;  // rad/s Normaltempo
      this.tilt = def.globe.tilt != null ? def.globe.tilt : 0.35;
      this.baseTilt = this.tilt;   // Ausgangs-Neigung, zu der der Pitch zurueckschwingt
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

  // waehlt zufaellig eine geladene Bild-Variante als aktuelles Bild (bei drift/loop pro Respawn neu)
  pickVariant() {
    if (this.variants && this.variants.length) {
      this.img = this.variants[Math.floor(Math.random() * this.variants.length)];
    }
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
        // einmal durchlaufen, dann am Anfang neu auftauchen (mit Fade) -> dabei neue Variante
        if (this.u > 1) { this.u = 0; this.respawnAlpha = 0; this.pickVariant(); }
        this.respawnAlpha = min(1, this.respawnAlpha + dt * 0.8);
        if (this.u > 0.9) this.respawnAlpha = max(0, (1 - this.u) / 0.1);
      } else { // loop
        if (this.u >= 1) this.pickVariant();   // pro Zyklus eine neue Variante (Schwarm variiert)
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
        // Pitch (hoch/runter): nach dem Loslassen zurueck zur Ausgangs-Neigung schwingen (gedaempfte Feder)
        this.tiltVel += (this.baseTilt - this.tilt) * 22.0 * dt;
        this.tiltVel *= Math.max(0, 1 - 4.5 * dt);
        this.tilt += this.tiltVel * dt;
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
      halo.addColorStop(0.42, `rgba(130,175,235,${0.25 * alpha})`);
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
    } else if (!handled && this.def.placeholder === 'island') {
      // prozedurale Bimsstein-Insel als Platzhalter, bis station_cutaway.png existiert.
      // An der Wasserlinie verankert: wlLocalY ist die Wasserlinie in lokalen (entity-)Koords.
      const wlLocalY = WATERLINE_FRAC * height - y;
      drawIslandPlaceholder(sz, wlLocalY, alpha);
    } else if (!handled) {
      // Platzhalter-Form: weicher Leuchtkleks (treibende Kreaturen-Leuchtpunkte)
      // global ~10% gedimmt -> Leuchtpunkte etwas reduziert (Station/Stein + Scene 1 unberuehrt)
      const a = alpha * 0.9;
      noStroke();
      const c = this.color;
      for (let i = 3; i >= 0; i--) {
        const r = sz * 0.5 * (0.5 + i * 0.22);
        fill(c[0], c[1], c[2], a * (10 + glow * 30) * (4 - i));
        ellipse(0, 0, r * 2);
      }
      fill(c[0], c[1], c[2], a * 220);
      ellipse(0, 0, sz * 0.42);
      fill(255, a * 60);
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

  // Barrierefreiheit: bei prefers-reduced-motion das ruhige drawUnderwater() statt des bewegten Shaders
  try { waterReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* matchMedia fehlt -> Shader */ }

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

// ============ WELTRAUM-HINTERGRUND (Nebel + Sterne + ruhige Zone, EINMAL gecacht) ============
// Synthese aus drei Subagenten-Rezepten: dunkler Void + faint Nebel (Quarter-Res-Noise hochskaliert)
// + realistisches Sternenfeld (Potenzgesetz-Helligkeit, Blackbody-Farbe, Glow) + Vignette/ruhige
// Zone hinter dem Globus. Statisch -> einmal in einen Buffer rendern, pro Frame nur ein image().
let spaceBuf = null;          // gecachter Backdrop (QUADRATISCH = Diagonale -> deckt jede Drehung ab)
const STAR_COUPLE = 0.06;     // wie stark die Sterne mit der Erde mitdrehen (leicht, selbe Achse)
let twinkleStars = [];        // wenige helle Sterne, die live funkeln
let spaceResizeTimer = null;

// ===== UNTERWASSER-BACKDROP (Scene 2) =====
// Analog zum Weltraum: statischer Tiefenverlauf einmal in einen Buffer cachen, pro Frame nur
// ein image() + die lebendigen, additiven Schichten (Gottesstrahlen, Kaustik, Marine Snow).
let underwaterBuf = null;     // gecachter statischer Verlauf (Smog -> Wasserlinie -> Tiefe) [Fallback]
let marineSnow = [];          // langsam sinkende Partikel (Position normiert 0..1, Tempo, Groesse) [Fallback]
const WATERLINE_FRAC = 0.30;  // Wasserlinie im oberen Drittel (Anteil der Hoehe)

// ===== WASSER-SHADER (Scene 2) =====
// Shader-basierter Backdrop: bewegte Oberflaeche + glaesernes Unterwasser. EIGENER WebGL-Buffer,
// getrennt von globeBuf (schuetzt Scene-1-Shader/Tiefen-State). Faellt auf drawUnderwater() zurueck,
// wenn createShader scheitert ODER prefers-reduced-motion gesetzt ist.
let waterBuf = null;           // WebGL-Graphics in reduzierter Aufloesung (hochskaliert wie GLOBE_BUF)
let waterShader = null;
let waterShaderFailed = false; // Shader nicht nutzbar -> dauerhaft Fallback drawUnderwater()
let waterReduceMotion = false; // prefers-reduced-motion -> Fallback (Ruhe statt Bewegung)
let waterProbed = false;       // einmalige Sicht-Pruefung nach dem ersten Render (faengt stillen Compile-Fehler)
const WATER_RENDER_SCALE = 0.5;// halbe Aufloesung -> ein Fragment-Pass, dann hochskaliert (60fps)
const WATER_MAX = 860;         // Deckel fuer die laengste Buffer-Kante
const WATER_LIGHTDIR = [0.18, 1.0];       // Richtung ZUM Licht (uv-Raum, leicht rechts wie die Scene-1-Sonne)
const WATER_LIGHTCOL = [1.0, 0.95, 0.82]; // warm-weiss/gold (gefilterte Sonne durch den Smog)

function buildSpace() {
  if (spaceBuf) spaceBuf.remove();
  const D = Math.ceil(Math.sqrt(vw() * vw() + vh() * vh())) + 4;   // Diagonale: Buffer deckt jede Rotation ab
  spaceBuf = createGraphics(D, D);
  spaceBuf.pixelDensity(1);
  drawDeepSpace(spaceBuf, D, D);    // Void + Nebel + Vignette (radial -> drehinvariant)
  buildStarfield(spaceBuf, D, D);   // Sterne darueber, fuellt twinkleStars
  bakeGlobeCalm(spaceBuf, D, D);    // ruhige, leicht abgedunkelte Zone hinter dem Globus (Buffer-Mitte = Bildmitte)
}

// alpha (0..1) blendet den ganzen Weltraum-Backdrop ein/aus (fuer den Szenen-Crossfade).
function drawSpace(alpha = 1) {
  if (!spaceBuf) buildSpace();
  // ganz leichte Drehung um die Bildmitte, gekoppelt an die Erddrehung (selbe Achse, Radius "hinter" dem Blick)
  const gl = allEntities.find(e => e.isGlobe);
  const ang = (gl ? gl.spinAngle : millis() / 1000 * -0.1) * STAR_COUPLE;
  push();
  imageMode(CENTER);
  translate(width / 2, height / 2);
  rotate(ang);
  tint(255, 255 * alpha);
  image(spaceBuf, 0, 0);   // Buffer-Mitte auf Bildmitte
  noTint();
  if (twinkleStars.length) {
    blendMode(ADD); noStroke();
    const now = millis() * 0.002, cx = spaceBuf.width / 2, cy = spaceBuf.height / 2;
    for (const s of twinkleStars) {
      const a = constrain(s.a + Math.sin(now + s.ph) * 40, 0, 255);
      fill(s.c[0], s.c[1], s.c[2], a * 0.6 * alpha);
      ellipse(s.x - cx, s.y - cy, s.r);   // Buffer-Koords relativ zur Mitte (im rotierten Frame)
    }
    blendMode(BLEND);
  }
  pop();
}

// Tiefer Raum: Void + faint Nebel + Staub + dezente Milchstrasse (Noise in Quarter-Res, hochskaliert)
function drawDeepSpace(g, w, h) {
  const VOID = [5, 6, 11];
  const NEB = [[40, 30, 52], [20, 40, 55], [55, 38, 30], [34, 22, 42]];   // entsaettigt: lila/teal/braun/magenta
  // RUHIG/realistisch (Erdnaehe): Nebel nur ein Hauch, Milchstrasse aus, viel Schwarz
  const NEB_CAP = 0.10, DUST_CAP = 0.18, MW_CAP = 0.0, VIGN = 0.55;
  const DS = 4;
  const sw = Math.max(2, Math.round(w / DS)), sh = Math.max(2, Math.round(h / DS));
  const buf = createGraphics(sw, sh); buf.pixelDensity(1);
  noiseSeed(7); noiseDetail(5, 0.55);
  buf.loadPixels();
  for (let py = 0; py < sh; py++) for (let px = 0; px < sw; px++) {
    const u = px / sw, v = py / sh;
    let r = VOID[0], gg = VOID[1], b = VOID[2];
    const wx = noise(u * 2.2, v * 2.2, 0.1), wy = noise(u * 2.2 + 3.3, v * 2.2 + 1.7, 0.1);
    let neb = noise(u * 2.6 + (wx - 0.5) * 0.9, v * 2.6 + (wy - 0.5) * 0.9, 0.1);
    neb = Math.pow(Math.max(0, (neb - 0.5) / 0.5), 1.7);
    const cn = noise(u * 0.8, v * 0.8, 10) * 3, i0 = Math.min(3, Math.floor(cn)), i1 = Math.min(3, i0 + 1), fr = cn - Math.floor(cn);
    const nA = neb * NEB_CAP;
    r += lerp(NEB[i0][0], NEB[i1][0], fr) * nA; gg += lerp(NEB[i0][1], NEB[i1][1], fr) * nA; b += lerp(NEB[i0][2], NEB[i1][2], fr) * nA;
    let dust = noise(u * 3.4 + 5, v * 3.4 + 9, 20); dust = Math.pow(Math.max(0, (dust - 0.55) / 0.45), 2);
    const dA = dust * DUST_CAP; r *= (1 - dA); gg *= (1 - dA); b *= (1 - dA);
    const diag = u * 0.9 + v, dd = Math.abs(diag - 0.95);
    const mA = Math.exp(-(dd * dd) / (2 * 0.16 * 0.16)) * (0.4 + 0.6 * noise(u * 5, v * 5, 30)) * MW_CAP;
    r += 150 * mA; gg += 150 * mA; b += 175 * mA;
    const k = 4 * (py * sw + px);
    buf.pixels[k] = Math.min(255, r); buf.pixels[k + 1] = Math.min(255, gg); buf.pixels[k + 2] = Math.min(255, b); buf.pixels[k + 3] = 255;
  }
  buf.updatePixels();
  g.background(VOID[0], VOID[1], VOID[2]);
  if (g.drawingContext) g.drawingContext.imageSmoothingEnabled = true;
  g.image(buf, 0, 0, w, h);
  const ctx = g.drawingContext;
  const diag = Math.hypot(vw(), vh());
  const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(vw(), vh()) * 0.22, w * 0.5, h * 0.5, diag * 0.46);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + VIGN + ')');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  buf.remove();
}

// Sternenfeld: viele schwache, wenige helle (Potenzgesetz), Blackbody-Farbe, Glow + Spikes fuer die hellsten
function buildStarfield(g, w, h) {
  g.noStroke(); twinkleStars = [];
  const N = Math.floor(w * h / 8000);   // SEHR SPARSAM: ~1 Stern / 8000 px^2 (ruhiger, realistischer Himmel; Zahl hoeher = noch weniger)
  const ctx = g.drawingContext;
  for (let i = 0; i < N; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const bMag = Math.pow(Math.random(), 3.2);          // viele schwach, wenige hell
    const alpha = 30 + bMag * 225;
    const temp = Math.pow(Math.random(), 0.55); let c;  // meist blau-weiss, wenige warm
    if (temp < 0.5) { const tt = temp / 0.5; c = [255, lerp(185, 245, tt), lerp(140, 235, tt)]; }
    else { const tt = (temp - 0.5) / 0.5; c = [lerp(255, 205, tt), lerp(245, 228, tt), 255]; }
    if (bMag < 0.92) {                                   // nur die obersten ~8% bekommen Glow -> ruhiger
      const dia = bMag < 0.5 ? 1.0 : 1.5;
      g.fill(c[0], c[1], c[2], alpha); g.ellipse(x, y, dia, dia);
    } else {
      const core = map(bMag, 0.92, 1, 1.6, 3.0), glow = map(bMag, 0.92, 1, 4, 12);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, glow);
      grad.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(alpha / 255) * 0.9})`);
      grad.addColorStop(0.25, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(alpha / 255) * 0.32})`);
      grad.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, glow, 0, Math.PI * 2); ctx.fill();
      g.fill(255, 255, 255, alpha); g.ellipse(x, y, core, core);
      if (twinkleStars.length < 18 && Math.random() < 0.4)
        twinkleStars.push({ x, y, r: core, c, a: alpha, ph: Math.random() * Math.PI * 2 });
    }
  }
}

// ruhige, leicht abgedunkelte Zone hinter dem (mittig sitzenden) Globus -> Sterne stoeren den Halo nicht
function bakeGlobeCalm(g, w, h) {
  const cx = w / 2, cy = h / 2, gr = Math.min(vw(), vh()) * 0.19;
  const ctx = g.drawingContext;
  const grad = ctx.createRadialGradient(cx, cy, gr * 0.6, cx, cy, gr * 1.7);
  grad.addColorStop(0, 'rgba(5,7,13,0.6)'); grad.addColorStop(1, 'rgba(5,7,13,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
}

// ============ UNTERWASSER-HINTERGRUND (Smog + Wasserlinie + Tiefe + lebendiges Licht) ============
// Querschnitt an der Wasserlinie (oberes Drittel): oben diesig-greller weissgoldener Smog-Himmel,
// darunter Verlauf Petrol -> Tiefblau -> nahezu Schwarz. Darueber leben Gottesstrahlen, Kaustik
// direkt unter der Oberflaeche und langsam sinkende Marine Snow. Statik gecacht, Rest pro Frame.

// statischen Verlauf einmal in einen Buffer backen (wie buildSpace) -> pro Frame nur ein image()
function buildUnderwater() {
  if (underwaterBuf) underwaterBuf.remove();
  const w = vw(), h = vh();
  underwaterBuf = createGraphics(w, h);
  underwaterBuf.pixelDensity(1);
  drawWaterColumn(underwaterBuf, w, h);
}

// Smog-Himmel + Wasserlinie + Tiefenverlauf + Lichtsaum + Tiefen-Vignette in einen Buffer zeichnen
function drawWaterColumn(g, w, h) {
  const wl = Math.round(h * WATERLINE_FRAC);   // y der Wasserlinie
  const ctx = g.drawingContext;
  // 1) Smog-Himmel ueber Wasser: diesig hell weissgold, zur Wasserlinie hin etwas satter
  let sky = ctx.createLinearGradient(0, 0, 0, wl);
  sky.addColorStop(0.0, '#f5edd6');            // grell weissgold
  sky.addColorStop(0.55, '#ecdcb8');
  sky.addColorStop(1.0, '#d8c79c');            // an der Wasserlinie waermer/satter
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, wl);
  // 2) Wassersaeule: Petrol (sonnendurchflutet) -> Tiefblau -> nahezu Schwarz in der Tiefe
  let sea = ctx.createLinearGradient(0, wl, 0, h);
  sea.addColorStop(0.0, '#2f6f7c');            // Petrol direkt unter der Oberflaeche
  sea.addColorStop(0.16, '#1c4f63');
  sea.addColorStop(0.46, '#0e2f47');           // Tiefblau
  sea.addColorStop(1.0, '#03070d');            // nahezu schwarz
  ctx.fillStyle = sea; ctx.fillRect(0, wl, w, h - wl);
  // 3) heller Lichtsaum direkt unter der Wasserlinie (Sonnenlicht bricht ein)
  let band = ctx.createLinearGradient(0, wl, 0, wl + h * 0.14);
  band.addColorStop(0, 'rgba(226,240,224,0.55)');
  band.addColorStop(1, 'rgba(226,240,224,0)');
  ctx.fillStyle = band; ctx.fillRect(0, wl, w, h * 0.14);
  // 4) Wasserlinie selbst: schmaler heller Saum
  ctx.fillStyle = 'rgba(244,248,234,0.8)'; ctx.fillRect(0, wl - 1, w, 2);
  // 5) Tiefen-Vignette: zieht den Blick nach unten in die Dunkelheit
  let vg = ctx.createRadialGradient(w * 0.5, wl + h * 0.12, Math.min(w, h) * 0.18,
                                    w * 0.5, h * 0.78, Math.hypot(w, h) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,6,0)');
  vg.addColorStop(1, 'rgba(0,0,8,0.6)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

// Partikel-Liste fuer Marine Snow einmal anlegen (normierte Koords -> resize-fest)
function buildMarineSnow() {
  marineSnow = [];
  const N = 150;
  for (let i = 0; i < N; i++) {
    marineSnow.push({
      x: Math.random(), y: Math.random(),
      vy: 0.018 + Math.random() * 0.04,   // normierte Sinkgeschwindigkeit /s (langsam)
      vx: (Math.random() - 0.5) * 0.01,   // ganz leichtes seitliches Driften /s
      r: 1 + Math.random() * 2.2,
      a: 35 + Math.random() * 95,
      ph: Math.random() * TWO_PI
    });
  }
}

// ein weicher Gottesstrahl (Lichtkegel) von der Wasserlinie nach unten, additiv, mit Tiefen-Fade
function drawGodRay(x, top, topW, botW, len, a) {
  const ctx = drawingContext;
  const grad = ctx.createLinearGradient(0, top, 0, top + len);
  grad.addColorStop(0, `rgba(255,250,224,${a})`);
  grad.addColorStop(0.5, `rgba(255,247,214,${a * 0.5})`);
  grad.addColorStop(1, 'rgba(255,247,214,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x - topW / 2, top);
  ctx.lineTo(x + topW / 2, top);
  ctx.lineTo(x + botW / 2, top + len);
  ctx.lineTo(x - botW / 2, top + len);
  ctx.closePath();
  ctx.fill();
}

// flimmerndes Kaustik-Netz direkt unter der Wasserlinie (helle Knoten, additiv)
function drawCaustics(w, wl, h, t, alpha) {
  noStroke();
  const bandH = h * 0.18, rows = 11;
  for (let r = 0; r < rows; r++) {
    const yy = wl + (r / rows) * bandH;
    const fade = 1 - r / rows;                          // direkt unter der Linie am hellsten
    for (let x = 0; x <= w; x += 24) {
      // zwei ueberlagerte Sinus -> wanderndes Interferenzmuster
      const n = Math.sin(x * 0.028 + t * 0.9 + r * 0.6) * Math.sin(x * 0.011 - t * 0.6 + r * 1.3);
      const b = Math.max(0, n);
      const aa = b * b * 30 * fade * alpha;
      if (aa < 1) continue;
      fill(202, 236, 222, aa);
      const s = 5 + b * 7;
      ellipse(x + Math.sin(t * 0.5 + r) * 7, yy, s, s * 0.55);
    }
  }
}

// kompletter Unterwasser-Backdrop bei gegebenem Alpha (0..1) -> deckend bei 1, ausblendbar fuer Crossfade
function drawUnderwater(alpha = 1) {
  if (!underwaterBuf) buildUnderwater();
  if (!marineSnow.length) buildMarineSnow();
  const w = width, h = height, wl = h * WATERLINE_FRAC;
  const t = millis() / 1000, dt = Math.min(0.05, deltaTime / 1000);

  push();
  // statischer Verlauf (deckend bei alpha=1) als Basis
  imageMode(CORNER);
  tint(255, 255 * alpha);
  image(underwaterBuf, 0, 0, w, h);
  noTint();

  // lebendige Schichten additiv darueber
  blendMode(ADD);
  noStroke();
  // Gottesstrahlen: wenige weiche Kegel von der Oberflaeche, langsam wandernd + sanft pulsierend
  const rays = 5;
  for (let i = 0; i < rays; i++) {
    const baseX = (i + 0.5) / rays * w;
    const sway = Math.sin(t * 0.06 + i * 1.7) * w * 0.05;          // langsames Wandern
    const x = baseX + sway;
    const len = h * (0.55 + 0.18 * Math.sin(t * 0.05 + i));
    const a = (0.05 + 0.035 * Math.sin(t * 0.4 + i * 2.1)) * alpha; // dezentes Pulsieren (0..~0.09)
    drawGodRay(x, wl, w * 0.045, w * 0.16, len, Math.max(0, a));
  }
  // Kaustik direkt unter der Wasserlinie
  drawCaustics(w, wl, h, t, alpha);
  // Marine Snow: langsam sinkende, feine Partikel (nur unter Wasser)
  for (const p of marineSnow) {
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    if (p.y > 1.03) { p.y = -0.03; p.x = Math.random(); }           // oben neu auftauchen
    const py = p.y * h;
    if (py < wl) continue;
    const px = (((p.x % 1) + 1) % 1) * w;
    fill(212, 226, 230, p.a * alpha);
    ellipse(px, py, p.r, p.r);
  }
  blendMode(BLEND);
  pop();
}

// =========================================================================
//  WASSER-SHADER (Scene 2) — bewegte Oberflaeche + glaesernes Unterwasser
//  Integration wie der Globus: eigener createGraphics(W,H,WEBGL)-Buffer + createShader,
//  als Vollbild-Backdrop komponiert; Entities zeichnen unveraendert im 2D-Layer darueber.
//
//  Die Techniken sind NACHGEBAUT (eigenes GLSL), inspiriert von diesen Shadertoy-Werken
//  (CC BY-NC-SA; dieses Projekt ist nicht-kommerziell/edukativ — HCU-Studienprojekt):
//    - Oberflaechen-/exp(sin)-Wellen + Fresnel/Glanz: "Seascape" von TDM            (Ms2SD1)
//    - Lichtschaefte / God Rays:                       "Light rays"                  (lljGDt)
//    - animierte Kaustik (Voronoi/Worley):             "Caustic Study #02: Pool"     (tX3BWl)
//  Angepasst an unsere SEITEN-Ansicht (Querschnitt an der Wasserlinie) + Smog-Palette.
// =========================================================================

// Vertex: simpler Durchreicher fuer das Vollbild-Plane (p5 liefert aPosition + Matrizen).
const WATER_VERT = `
precision highp float;
attribute vec3 aPosition;
uniform mat4 uModelViewMatrix, uProjectionMatrix;
void main(){ gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0); }`;

// Fragment: rechnet pro Pixel ueber gl_FragCoord/uResolution (kein TexCoord noetig).
const WATER_FRAG = `
precision highp float;
uniform float uTime;
uniform vec2  uResolution;
uniform float uWaterlineY;   // Wasserlinie als Anteil von OBEN (0=oben .. 1=unten), ~0.30
uniform vec2  uLightDir;     // Richtung ZUM Licht (uv-Raum, y nach oben)
uniform vec3  uLightColor;   // warm-weiss/gold (gefilterte Sonne)

// ---------- Noise-Bausteine (Value-Noise + fbm, GLSL-ES-1.00 tauglich) ----------
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1.0,0.0)), c=hash21(i+vec2(0.0,1.0)), d=hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v += a*vnoise(p); p = p*2.0 + vec2(1.7,9.2); a*=0.5; }
  return v;
}

// ---------- Oberflaeche: exp(sin)-Wellen (Technik: "Seascape", TDM / Ms2SD1) ----------
// Edge-on (1D): Summe weniger exp(sin)-Terme schaerft die Kaemme; leicht rauschmoduliert
// gegen Periodizitaet. Liefert die animierte Hoehe der Wasserlinie an Spalte x.
float waveHeight(float x, float t){
  float h=0.0, amp=1.0, freq=4.0, ph=0.0;
  for(int i=0;i<4;i++){
    float s = sin(x*freq + t*(0.6 + 0.25*freq) + ph);
    s = exp(s - 1.0);                                  // exp(sin): spitze Kaemme, flache Taeler
    s *= 0.6 + 0.4*vnoise(vec2(x*freq*0.5, t*0.2));    // dezente Unruhe
    h += s*amp;
    amp*=0.5; freq*=1.9; ph+=1.7;
  }
  return h;
}

// ---------- Kaustik: animiertes Worley (Technik: "Caustic Study #02: Pool" / tX3BWl) ----------
// Voronoi-Zellen mit wandernden Punkten; helle duenne Kanten -> tanzendes Geflecht.
float worley(vec2 p, float t){
  vec2 ip=floor(p), fp=fract(p);
  float md=1.0;
  for(int j=-1;j<=1;j++)
  for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec2 o=vec2(hash21(ip+g), hash21(ip+g+19.19));
    o = 0.5 + 0.5*sin(t + 6.2831*o);                   // Zellpunkte wandern (Animation)
    md = min(md, length(g+o-fp));
  }
  return md;
}
float caustics(vec2 uv, float t){
  float c=0.0, sc=7.0, amp=1.0;
  for(int i=0;i<3;i++){                                 // <= 3 Lagen
    float w = worley(uv*sc + vec2(t*0.12*float(i+1), t*0.03), t*0.7);
    c += amp * pow(max(0.0, 1.0 - w), 6.0);            // duenne helle Filamente an den Zellkanten
    sc*=1.8; amp*=0.55;
  }
  return c;
}

// ---------- God Rays: Lichtschaefte (Technik: "Light rays" / lljGDt) ----------
// Entlang der Lichtrichtung akkumulierte, von scrollendem Noise verdeckte Helligkeit
// -> leicht schwankende Schaefte. <= 24 Samples.
float godrays(vec2 uv, vec2 ldir, float t){
  float acc=0.0;
  vec2 p=uv;
  for(int i=0;i<24;i++){
    p += ldir * 0.02;                                   // Schritt Richtung Licht (zur Oberflaeche)
    float m = vnoise(vec2(p.x*7.0 + t*0.10, p.y*2.2 - t*0.03));  // scrollende Verdeckung
    acc += smoothstep(0.42, 0.95, m);
  }
  return acc / 24.0;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;              // 0..1, y von UNTEN
  float aspect = uResolution.x / uResolution.y;
  float t = uTime;

  float surfaceY = 1.0 - uWaterlineY;                   // Wasserlinie als y-von-unten
  float xw = uv.x * aspect;                             // seitenverhaeltnis-korrigiertes x

  // animierte Oberflaechenhoehe (kleine Auslenkung)
  float wave = (waveHeight(xw*2.2, t) - 0.55) * 0.022;
  float surf = surfaceY + wave;                         // Oberflaeche an dieser Spalte
  float d = uv.y - surf;                                // >0 ueber Wasser, <0 unter Wasser

  // glaesernes Volumen: leichte horizontale Refraktions-Verzerrung, mit Tiefe zunehmend
  float depth = clamp((surf - uv.y) / max(surf, 0.001), 0.0, 1.0); // 0 Oberflaeche .. 1 Grund
  float wob = (fbm(vec2(uv.y*9.0 - t*0.08, t*0.05)) - 0.5);
  vec2 ruv = vec2(uv.x + wob*0.012*depth, uv.y);        // gebrochene UV fuer Tiefe/Kaustik

  // ===== Basisfarben IMMER berechnen (guenstig) -> erlaubt weichen Uebergang statt hartem if =====
  // Smog-Himmel (weiss-gold, nach oben heller)
  vec3 skyLo = vec3(0.82, 0.76, 0.58);
  vec3 skyHi = vec3(0.96, 0.93, 0.83);
  vec3 skyCol = mix(skyLo, skyHi, smoothstep(surfaceY, 1.0, uv.y));
  skyCol += (fbm(vec2(uv.x*3.0, uv.y*2.0) + t*0.015) - 0.5) * 0.04;  // Hauch Smog-Struktur
  // glaesernes Wasservolumen (Petrol/Teal -> Tiefblau -> fast Schwarz)
  vec3 teal = vec3(0.16, 0.40, 0.42);
  vec3 deep = vec3(0.04, 0.14, 0.24);
  vec3 ink  = vec3(0.01, 0.03, 0.06);
  vec3 waterCol = mix(teal, deep, smoothstep(0.0, 0.45, depth));
  waterCol = mix(waterCol, ink, smoothstep(0.42, 1.0, depth));

  // ===== WEICHER Wasserlinie-Uebergang (analytisches Anti-Aliasing) =====
  // smoothstep ueber ein schmales, AUFLOESUNGS-ABHAENGIGES Band (~2.5 Buffer-Pixel) -> glatte
  // Kante trotz halber Buffer-Aufloesung; ersetzt den harten if(d>0)-Sprung (war "pixelig").
  float aa = 2.5 / uResolution.y;
  float below = smoothstep(-aa, aa, -d);                 // 0 = Himmel, 1 = Wasser
  vec3 col = mix(skyCol, waterCol, below);

  // ===== Unterwasser-Lichteffekte: nur unter Wasser, weich ueber 'below' eingeblendet =====
  if(d < aa){
    // God Rays: mit der Tiefe ausblendend, additiv warm
    float gr = godrays(ruv, normalize(uLightDir), t);
    float grFade = 1.0 - smoothstep(0.0, 0.28, depth);   // ~1/3 so lang (frueher bis 0.85)
    col += uLightColor * gr * grFade * 0.5 * below;
    // Kaustik: am staerksten direkt unter der Oberflaeche, mit Tiefe schwaecher
    float ca = caustics(ruv * vec2(aspect, 1.0) * 3.0, t);
    float caFade = 1.0 - smoothstep(0.0, 0.6, depth);
    col += uLightColor * ca * caFade * 0.35 * below;
    // Marine Snow: WENIGE, langsam sinkende, feine Specks (additiv)
    vec2 sq = vec2(uv.x*aspect, uv.y) * 38.0;
    sq.y += t*0.5;                                       // sinkt langsam
    vec2 sip = floor(sq), sfp = fract(sq);
    if(hash21(sip) > 0.965){                             // hohe Schwelle -> sparsam
      float dd = length(sfp - 0.5);
      col += uLightColor * smoothstep(0.13, 0.0, dd) * 0.4 * (1.0 - depth*0.5) * below;
    }
  }

  // ===== OBERFLAECHEN-BAND (edge-on): DUNKLE, dezente Linie + nur VEREINZELTE Glanzreflexe =====
  // (kein durchgehender heller Streifen mehr -> Oberflaeche dunkler, Licht blitzt nur stellenweise)
  float aw = abs(d);
  float line = exp(-pow(aw / 0.008, 2.0));              // sehr duenne, dezente Oberflaechenlinie
  // gedaempfte Smog-Reflexion knapp unter der Oberflaeche; 'below' (weich) statt hartem step
  float band = exp(-pow(max(0.0, -d) / 0.040, 2.0)) * below;
  vec3 reflCol = vec3(0.74, 0.70, 0.58);                // gedaempfte Smog-Reflexion (dunkler)
  col = mix(col, reflCol, band * 0.10);
  // vereinzelte, wandernde Glanzreflexe: nur die Rauschspitzen (hohe Schwelle) -> selten, verstreut
  float gz = vnoise(vec2(xw*15.0 - t*0.5, t*0.55));
  float spark = smoothstep(0.86, 0.99, gz);
  spark *= spark;                                       // schaerfer -> wirklich vereinzelt
  float sparkMask = exp(-pow(d / 0.014, 2.0));          // schmales Band um die Oberflaeche
  col += uLightColor * (line * 0.07 + spark * sparkMask * 0.75);

  // sanfte Tiefen-/Rand-Vignette (zieht den Blick in die Tiefe)
  float vig = smoothstep(1.15, 0.25, length((uv - vec2(0.5, surfaceY)) * vec2(aspect*0.7, 1.0)));
  col *= mix(0.78, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}`;

// eigenen WebGL-Buffer + Shader anlegen (reduzierte Aufloesung, hochskaliert). Bei Fehler -> Fallback.
function ensureWaterBuffer() {
  if (waterReduceMotion || waterShaderFailed || waterBuf) return;
  try {
    let bw = Math.round(vw() * WATER_RENDER_SCALE);
    let bh = Math.round(vh() * WATER_RENDER_SCALE);
    const m = Math.max(bw, bh);
    if (m > WATER_MAX) { const k = WATER_MAX / m; bw = Math.round(bw * k); bh = Math.round(bh * k); }
    bw = Math.max(2, bw); bh = Math.max(2, bh);
    const buf = createGraphics(bw, bh, WEBGL);
    buf.pixelDensity(1);                                 // feste reduzierte Aufloesung (kein Retina-Doppeln)
    const sh = buf.createShader(WATER_VERT, WATER_FRAG);
    waterBuf = buf; waterShader = sh; waterProbed = false;
  } catch (e) {
    console.warn('Wasser-Shader nicht verfuegbar -> Fallback drawUnderwater()', e);
    waterShaderFailed = true;
    if (waterBuf) { waterBuf.remove(); waterBuf = null; }
    waterShader = null;
  }
}

// Shader-Wasser als Vollbild-Backdrop (Crossfade-Alpha wie space/underwater). Faellt auf
// drawUnderwater() zurueck bei reduced-motion, createShader-Fehler oder leerem ersten Render.
function drawWater(alpha = 1) {
  if (waterReduceMotion || waterShaderFailed) { drawUnderwater(alpha); return; }
  ensureWaterBuffer();
  if (!waterBuf || !waterShader) { drawUnderwater(alpha); return; }
  try {
    const g = waterBuf;
    g.clear();
    g.noStroke();
    g.shader(waterShader);
    waterShader.setUniform('uTime', millis() / 1000);
    waterShader.setUniform('uResolution', [g.width, g.height]);
    waterShader.setUniform('uWaterlineY', WATERLINE_FRAC);
    waterShader.setUniform('uLightDir', WATER_LIGHTDIR);
    waterShader.setUniform('uLightColor', WATER_LIGHTCOL);
    g.plane(g.width + 2, g.height + 2);                  // Vollbild-Quad (kleiner Overscan gegen Randnaht)
    g.resetShader();
    // einmalige Sicht-Pruefung: rendert der Shader gar nichts (stiller Compile-Fehler) -> Fallback
    if (!waterProbed) {
      waterProbed = true;
      const px = g.get(g.width >> 1, g.height >> 1);
      if (!px || px[3] < 5) throw new Error('leerer Render (vermutlich Shader-Compile-Fehler)');
    }
  } catch (e) {
    console.warn('Wasser-Shader Render fehlgeschlagen -> Fallback drawUnderwater()', e);
    waterShaderFailed = true;
    if (waterBuf) { waterBuf.remove(); waterBuf = null; }
    waterShader = null;
    drawUnderwater(alpha);
    return;
  }
  push();
  imageMode(CORNER);
  tint(255, 255 * alpha);
  image(waterBuf, 0, 0, width, height);                 // reduzierte Aufloesung hochskaliert
  pop();
}

// ===== PROZEDURALE KLEINFAUNA (Scene 2): Krill-Wolke + kleiner Fischschwarm (KEINE Bilder) =====
// Wird ueber dem Wasser-Backdrop, unter den Bild-Entities gezeichnet (drawSceneBackdrop) und
// blendet mit dem Szenen-Crossfade (alpha). Positionen normiert (resize-fest), Update pro Frame.
let krillParts = [];   // feine Glitzer-Partikel
let fishSchool = [];   // kleiner Schwarm: Offsets um ein langsam wanderndes Zentrum

function buildScene2Fauna() {
  krillParts = [];
  for (let i = 0; i < 150; i++) {
    krillParts.push({
      x: 0.16 + Math.random() * 0.68, y: 0.40 + Math.random() * 0.24,   // Mittelwasser
      r: 0.6 + Math.random() * 1.5, a: 22 + Math.random() * 60,         // sehr fein, dezent
      ph: Math.random() * TWO_PI,                                       // Glitzer-Phase
      vx: (Math.random() - 0.5) * 0.006, vy: (Math.random() - 0.5) * 0.003
    });
  }
  fishSchool = [];
  for (let i = 0; i < 16; i++) {
    fishSchool.push({
      ox: (Math.random() - 0.5) * 0.11, oy: (Math.random() - 0.5) * 0.05,  // Offset um das Zentrum
      ph: Math.random() * TWO_PI, s: 0.7 + Math.random() * 0.6,            // Wackel-Phase + Groesse
      px: 0, py: 0, sz: 1
    });
  }
}

function drawScene2Fauna(alpha) {
  if (!krillParts.length) buildScene2Fauna();
  const w = width, h = height, mm = Math.min(w, h);
  const t = millis() / 1000, dt = Math.min(0.05, deltaTime / 1000);

  push();
  noStroke();

  // Krill: feine glitzernde Partikelwolke (additiv), langsames Driften + Glitzern
  blendMode(ADD);
  for (const p of krillParts) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < 0.12 || p.x > 0.88) p.vx = -p.vx;          // sanft in der Wolke gehalten
    if (p.y < 0.36 || p.y > 0.66) p.vy = -p.vy;
    const tw = 0.35 + 0.65 * Math.max(0.0, Math.sin(t * 1.6 + p.ph));   // Glitzern
    fill(198, 224, 218, p.a * tw * alpha);
    ellipse(p.x * w, p.y * h, p.r, p.r);
  }
  blendMode(BLEND);

  // kleiner Fischschwarm: winzige dunkel-silbrige Formen + faint Photophor-Glow, ruhig schwarmend
  const cx = 0.5 + 0.30 * Math.sin(t * 0.05);           // wanderndes Zentrum (quer durchs Mittelwasser)
  const cy = 0.40 + 0.035 * Math.sin(t * 0.085);
  const dir = Math.cos(t * 0.05) >= 0 ? 1 : -1;         // Schwimmrichtung (Kopf vorne)
  for (const f of fishSchool) {
    f.px = (cx + f.ox + 0.018 * Math.sin(t * 0.5 + f.ph)) * w;
    f.py = (cy + f.oy + 0.010 * Math.cos(t * 0.6 + f.ph)) * h;
    f.sz = f.s * mm * 0.011;                             // winzig
  }
  for (const f of fishSchool) {                          // dunkel-silbrige Koerper (elongiert)
    fill(150, 165, 176, 150 * alpha);
    ellipse(f.px, f.py, f.sz * 2.4, f.sz);
  }
  blendMode(ADD);                                        // faint Photophor-Glow am Kopf
  for (const f of fishSchool) {
    fill(180, 212, 202, 80 * alpha);
    ellipse(f.px + dir * f.sz * 0.9, f.py, f.sz * 0.8, f.sz * 0.8);
  }
  blendMode(BLEND);
  pop();
}

// Platzhalter fuer das Stations-Hero, bis station_cutaway.png existiert: eine prozedurale
// Bimsstein-Insel-Silhouette mit Blasenloechern (warm bewohnt / dunkel) + versiegelter Krone
// ueber Wasser (Schacht + Kollektor + glattes Dach). Origin = Entity-Mitte; top = Wasserlinie lokal.
function drawIslandPlaceholder(sz, top, alpha) {
  const ctx = drawingContext;
  const Wp = sz * 0.46;            // Breite des Steins
  const lx = -Wp / 2, rx = Wp / 2;
  // Hoehe haengt an der GROESSE (sz), nicht am Wasserlinie-Mitte-Abstand -> proportional skalierbar:
  // Krone an der Wasserlinie (top), Koerper ~0.62*sz tief darunter. So bleibt die Form bei kleinerer
  // scale gut proportioniert (statt zu schmalem Splitter) und laesst Wasser-Platz nach unten.
  const bottom = top + sz * 0.62;  // unteres Ende des Steins (lokal)
  ctx.save();
  ctx.globalAlpha = alpha;
  // poroese Stein-Silhouette (organische Bezier-Kontur, oben an der Wasserlinie, nach unten verjuengt)
  ctx.beginPath();
  ctx.moveTo(lx, top + sz * 0.05);
  ctx.bezierCurveTo(lx, top - sz * 0.015, -Wp * 0.20, top - sz * 0.02, -Wp * 0.04, top - sz * 0.01);
  ctx.bezierCurveTo(Wp * 0.16, top - sz * 0.02, rx, top - sz * 0.005, rx, top + sz * 0.06);
  ctx.bezierCurveTo(rx * 1.05, top + (bottom - top) * 0.5, Wp * 0.30, bottom, 0, bottom);
  ctx.bezierCurveTo(-Wp * 0.32, bottom, lx * 1.05, top + (bottom - top) * 0.5, lx, top + sz * 0.05);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, 'rgb(104,98,90)');     // poroeser Stein, vom Smog beleuchtet
  g.addColorStop(0.45, 'rgb(58,60,62)');
  g.addColorStop(1, 'rgb(16,22,28)');      // unten in der Tiefe
  ctx.fillStyle = g; ctx.fill();
  // Blasenloecher: einige warm bewohnt (Glow), einige dunkel
  const holes = [
    [-0.22, 0.14, 0.052, 1], [0.12, 0.10, 0.044, 1], [0.26, 0.24, 0.040, 0],
    [-0.06, 0.30, 0.050, 1], [0.00, 0.50, 0.058, 0], [-0.28, 0.40, 0.038, 0],
    [0.30, 0.46, 0.046, 1], [-0.16, 0.58, 0.044, 0], [0.16, 0.66, 0.038, 1],
    [-0.02, 0.74, 0.050, 0], [0.34, 0.66, 0.034, 0]
  ];
  for (const [hx, hy, hr, warm] of holes) {
    const cx = hx * Wp, cy = top + hy * (bottom - top), r = hr * sz;
    if (warm) {
      const wg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.8);
      wg.addColorStop(0, 'rgba(255,198,122,0.95)');
      wg.addColorStop(0.5, 'rgba(232,150,80,0.5)');
      wg.addColorStop(1, 'rgba(232,150,80,0)');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(cx, cy, r * 1.8, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = 'rgba(255,224,176,1)'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, TWO_PI); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(6,10,14,0.85)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TWO_PI); ctx.fill();
    }
  }
  // Krone ueber Wasser: schlanker Schacht + Kollektor + versiegeltes glattes Dach
  const crownW = sz * 0.15, crownH = sz * 0.085, shaftH = sz * 0.11;
  ctx.fillStyle = 'rgb(208,212,212)';
  ctx.fillRect(-sz * 0.011, top - shaftH, sz * 0.022, shaftH);                  // Schacht
  ctx.fillStyle = 'rgb(240,240,230)';
  ctx.beginPath(); ctx.arc(0, top - shaftH, sz * 0.017, 0, TWO_PI); ctx.fill(); // Kollektor (Knauf)
  const dg = ctx.createLinearGradient(0, top - crownH, 0, top);
  dg.addColorStop(0, 'rgb(240,238,228)');
  dg.addColorStop(1, 'rgb(198,196,186)');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.moveTo(-crownW / 2, top);
  ctx.quadraticCurveTo(-crownW / 2, top - crownH, 0, top - crownH);
  ctx.quadraticCurveTo(crownW / 2, top - crownH, crownW / 2, top);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// --- Sonne + Mond umkreisen die Erde (Bildmitte). Erd-Beleuchtung folgt der Sonne (currentSunWorld). ---
const SUN_ORBIT_SPEED = 0.03, MOON_ORBIT_SPEED = 0.10;   // rad/s (Sonne langsam, Mond sichtbar kreisend)
const SUN_ORBIT_R = 0.42, MOON_ORBIT_R = 0.30;           // Orbit-Radius * min(w,h)
const SUN_START = 0.5;                                    // Start-Winkel (~ oben-rechts wie zuvor)
const SUN_KXY = 0.6, SUN_KZ = 0.78;                       // seitlicher vs. frontaler Lichtanteil (KZ hoch -> meist Tag)

// Weltrichtung zur Sonne aus dem Orbit-Winkel; +y_SUN = oben (empirisch), passt zur sichtbaren Sonnenposition
function currentSunWorld() {
  const a = millis() / 1000 * SUN_ORBIT_SPEED + SUN_START;
  return norm3([Math.cos(a) * SUN_KXY, -Math.sin(a) * SUN_KXY, SUN_KZ]);   // -sin: Erdlicht oben, wenn Sonne oben
}

// alpha (0..1) blendet Sonne + Mond mit der Weltraum-Szene ein/aus (Crossfade). globalAlpha
// skaliert alle nachfolgenden Canvas-Alphas der Gradienten in drawSun/drawMoon.
function drawSunMoon(alpha = 1) {
  if (alpha <= 0.001) return;
  const ctx = drawingContext, prevGA = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  const mm = Math.min(width, height), cx = width / 2, cy = height / 2;
  const sa = millis() / 1000 * SUN_ORBIT_SPEED + SUN_START;
  const ma = millis() / 1000 * MOON_ORBIT_SPEED;
  const sx = cx + Math.cos(sa) * SUN_ORBIT_R * mm, sy = cy - Math.sin(sa) * SUN_ORBIT_R * mm; // sin>0 -> oben
  const mx = cx + Math.cos(ma) * MOON_ORBIT_R * mm, my = cy - Math.sin(ma) * MOON_ORBIT_R * mm;
  drawSun(sx, sy, mm * 0.05);                              // groesser
  let ldx = sx - mx, ldy = sy - my; const ln = Math.hypot(ldx, ldy) || 1;  // Lichtrichtung Mond -> Sonne
  drawMoon(mx, my, mm * 0.032, ldx / ln, ldy / ln);        // kleiner, Phase folgt der Sonne
  ctx.globalAlpha = prevGA;
}

function drawSun(x, y, r) {
  const ctx = drawingContext;
  push(); noStroke();
  blendMode(ADD);                                   // glueht auf dem dunklen Weltraum
  let glow = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
  glow.addColorStop(0.0, 'rgba(255,246,214,0.85)');
  glow.addColorStop(0.10, 'rgba(255,232,168,0.45)');
  glow.addColorStop(0.35, 'rgba(255,205,120,0.12)');
  glow.addColorStop(1.0, 'rgba(255,190,100,0)');
  ctx.fillStyle = glow; ctx.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
  blendMode(BLEND);
  let core = ctx.createRadialGradient(x, y, 0, x, y, r);
  core.addColorStop(0, 'rgba(255,255,252,1)');
  core.addColorStop(0.65, 'rgba(255,247,220,1)');
  core.addColorStop(1, 'rgba(255,236,190,0.95)');
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.fill();
  pop();
}

function drawMoon(x, y, r, ldx, ldy) {
  const ctx = drawingContext;
  push(); noStroke();
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.clip();
  // Phase: lineare Beleuchtung entlang Lichtrichtung (ferne Sonne -> Terminator durch die Scheibe)
  let g = ctx.createLinearGradient(x - ldx * r, y - ldy * r, x + ldx * r, y + ldy * r);
  g.addColorStop(0.0, 'rgba(22,22,28,1)');          // Nachtseite (Hauch Erdschein)
  g.addColorStop(0.45, 'rgba(58,58,64,1)');
  g.addColorStop(0.60, 'rgba(132,132,134,1)');
  g.addColorStop(1.0, 'rgba(222,222,216,1)');        // Sonnenseite
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // Maria/Krater: ein paar weiche dunkle Flecken
  const maria = [[-0.25, -0.20, 0.30], [0.18, 0.05, 0.22], [-0.05, 0.35, 0.18], [0.35, -0.30, 0.14]];
  for (const m of maria) {
    let mg = ctx.createRadialGradient(x + m[0] * r, y + m[1] * r, 0, x + m[0] * r, y + m[1] * r, m[2] * r);
    mg.addColorStop(0, 'rgba(0,0,0,0.22)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  pop();
}

function draw() {
  const dt = Math.min(0.05, deltaTime / 1000); // s, gedeckelt gegen Tab-Sprung

  // Hintergrund: aktuelle Szene DECKEND als Basis, naechste Szene per Alpha darueber einblenden.
  // So ist der Crossfade ein sauberes B*f over A (kein Mittel-Abdunkeln, kein Pop am Umschalten).
  // drawSceneBackdrop kapselt prozedural (space/underwater), Bild- und Farbhintergruende inkl. Sonne/Mond.
  drawSceneBackdrop(currentScene, 1);
  if (nextScene >= 0) drawSceneBackdrop(nextScene, sceneFade);

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
  // Hover-Erkennung (oberstes zuerst). Nicht-interaktive Entities (interactive:false) erzeugen
  // kein Hover-Label und keinen Cursor-Wechsel.
  for (let i = allEntities.length - 1; i >= 0; i--) {
    const ent = allEntities[i];
    if (ent.def.interactive === false) continue;
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

// Zeichnet den KOMPLETTEN Hintergrund einer Szene bei gegebenem Alpha (0..1) -> eine Funktion
// fuer alle Szenentypen, damit der Crossfade beliebige Kombinationen sauber ueberblendet:
//   space     -> prozeduraler Weltraum + Sonne/Mond
//   underwater -> prozedurale Unterwasser-Atmosphaere
//   sc.bg      -> bildschirmfuellendes Hintergrundbild (cover)
//   sonst      -> einfarbig aus backgroundTint
function drawSceneBackdrop(index, alpha) {
  const sc = scenes[index];
  if (!sc || alpha <= 0.001) return;
  if (sc.space) {
    drawSpace(alpha);
    drawSunMoon(alpha);     // Sonne + Mond gehoeren zur Weltraum-Szene, blenden mit (hinter den Entities)
    return;
  }
  if (sc.underwater) {
    drawWater(alpha);          // Shader-Wasser; faellt intern auf drawUnderwater() zurueck
    drawScene2Fauna(alpha);    // prozedurale Kleinfauna (Krill + Fischschwarm) ueber dem Wasser
    return;
  }
  push();
  if (sc.bg) {
    // bildschirmfuellend (cover)
    const ir = sc.bg.width / sc.bg.height;
    const cr = width / height;
    let w, h;
    if (ir > cr) { h = height; w = height * ir; } else { w = width; h = width / ir; }
    imageMode(CENTER);
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
    if (ent.def.interactive === false) continue;   // nicht-interaktiv: kein Panel, kein Greifen
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
    const dPit = -(mouseY - pmouseY) * k;    // vertikal -> hoch/runter (invertiert = natuerliche Richtung)
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

function windowResized() {
  resizeCanvas(vw(), vh());
  if (spaceResizeTimer) clearTimeout(spaceResizeTimer);
  spaceResizeTimer = setTimeout(() => {
    buildSpace();              // gecachten Weltraum-Backdrop neu bauen (entprellt)
    underwaterBuf = null;      // Unterwasser-Buffer verwerfen -> drawUnderwater baut ihn in neuer Groesse neu
    if (waterBuf) { waterBuf.remove(); waterBuf = null; waterShader = null; }  // Wasser-Shader-Buffer in neuer Groesse neu bauen
  }, 180);
}
