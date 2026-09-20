import type * as Three from "three";

/**
 * WebGL scene behind the landing page: a glass pill bottle whose cap unscrews and whose pills
 * pour out as the page scrolls. Every position is a pure function of scroll progress
 * (0 = top of the page, 1 = bottom), so scrolling back up runs the motion in reverse.
 *
 * three.js is passed in rather than imported here, so the caller can load it with a dynamic
 * import() and keep it out of every other route's JavaScript.
 */
type ThreeModule = typeof Three;

export type LabelFonts = { mono: string; wordmark: string };
export type LandingScene = { dispose: () => void };

const PILL_COUNT = 48;
const BOTTLE_TINT = "#d07c24";
const GRAVITY = 13;

// Scene background colour at each scroll progress value. Colours between stops are blended.
const BG_STOPS: [number, string][] = [
  [0, "#1f3864"],
  [0.2, "#27507c"],
  [0.42, "#2b8f66"],
  [0.68, "#0f5e43"],
  [0.86, "#173261"],
  [1, "#0d1d3d"],
];

// The two halves of each capsule.
const PILL_COLORS: [string, string][] = [
  ["#147a57", "#f4f1ea"],
  ["#1f3864", "#f1eee8"],
  ["#b3462b", "#fdfcfa"],
  ["#d07c24", "#fbf3e4"],
  ["#3b5b8c", "#fdfcfa"],
  ["#147a57", "#1f3864"],
  ["#e0b13a", "#fdfcfa"],
];

type Pill = {
  mesh: Three.Mesh;
  tab: boolean;
  inside: Three.Vector3;
  lq: Three.Quaternion;
  t0: number;
  speed: number;
  vx: number;
  vz: number;
  axis: Three.Vector3;
  spin: number;
  floorJ: number;
  yaw: number;
  tilt: number;
};

/** 0 below a, 1 above b, eased in between. Also works with a > b. */
export function smoothstep(a: number, b: number, p: number) {
  const t = Math.max(0, Math.min(1, (p - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The bottle label is drawn on a 2D canvas, and canvas text needs real font-family names.
 * next/font publishes those names in CSS variables on <html>, so read them from there and
 * wait for both files to load, otherwise the label is drawn in a fallback font.
 */
export async function loadLabelFonts(): Promise<LabelFonts> {
  const css = getComputedStyle(document.documentElement);
  const family = (name: string, fallback: string) => [css.getPropertyValue(name).trim(), fallback].filter(Boolean).join(", ");
  const fonts = { mono: family("--font-geist-mono", "monospace"), wordmark: family("--font-goudy", "Georgia, serif") };
  await Promise.all([document.fonts.load(`80px ${fonts.wordmark}`), document.fonts.load(`700 20px ${fonts.mono}`)]).catch(() => {});
  return fonts;
}

function draw(w: number, h: number, paint: (x: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  if (!x) throw new Error("2D canvas context is unavailable");
  paint(x);
  return c;
}

function labelCanvas({ mono, wordmark }: LabelFonts) {
  return draw(1024, 706, (x) => {
    x.fillStyle = "#FDFCFA";
    x.fillRect(0, 0, 1024, 706);
    x.strokeStyle = "rgba(20,122,87,.09)";
    x.lineWidth = 2;
    for (let i = 1; i < 18; i++) {
      x.beginPath();
      x.moveTo(0, i * 40);
      x.lineTo(1024, i * 40);
      x.stroke();
    }
    x.fillStyle = "#147a57";
    x.fillRect(64, 54, 896, 22);
    x.fillStyle = "#4a3a1c";
    x.font = `700 26px ${mono}`;
    x.fillText("Rx ONLY", 64, 128);
    x.textAlign = "right";
    x.fillText("No. 0919-26", 960, 128);
    x.textAlign = "left";
    x.fillStyle = "#1f3864";
    x.font = `400 196px ${wordmark}`;
    x.fillText("Dosely", 56, 316);
    x.fillStyle = "#4a3a1c";
    x.font = `400 28px ${mono}`;
    x.fillText("patient recall · 1 visit", 64, 364);
    x.fillStyle = "#2b2417";
    x.font = `700 38px ${mono}`;
    x.fillText("TAKE ONE VISIT", 64, 436);
    x.fillText("EVERY 6 MONTHS.", 64, 484);
    x.strokeStyle = "#e2dccf";
    x.beginPath();
    x.moveTo(64, 526);
    x.lineTo(960, 526);
    x.stroke();
    const fields: [string, string, number][] = [["QTY", "141 booked", 64], ["REFILLS", "automatic", 400], ["DR.", "Patel", 740]];
    for (const [key, value, px] of fields) {
      x.fillStyle = "#6f6b63";
      x.font = `400 20px ${mono}`;
      x.fillText(key, px, 566);
      x.fillStyle = "#2b2417";
      x.font = `700 28px ${mono}`;
      x.fillText(value, px, 602);
    }
    // Barcode: bars of random width.
    x.fillStyle = "#2b2417";
    let bx = 64;
    while (bx < 700) {
      const w = [3, 5, 8, 4][Math.floor(Math.random() * 4)];
      x.fillRect(bx, 632, w, 56);
      bx += w + [3, 5, 7][Math.floor(Math.random() * 3)];
    }
  });
}

/** Bump map for the grip ridges around the cap. */
function ridgeCanvas() {
  return draw(1024, 8, (x) => {
    for (let i = 0; i < 128; i++) {
      const g = x.createLinearGradient(i * 8, 0, i * 8 + 8, 0);
      g.addColorStop(0, "#666");
      g.addColorStop(0.5, "#fff");
      g.addColorStop(1, "#444");
      x.fillStyle = g;
      x.fillRect(i * 8, 0, 8, 8);
    }
  });
}

function capTopCanvas() {
  return draw(512, 512, (x) => {
    const ring = (r: number) => {
      x.beginPath();
      x.arc(256, 256, r, 0, Math.PI * 2);
    };
    x.fillStyle = "#ECE8E0";
    x.fillRect(0, 0, 512, 512);
    x.strokeStyle = "rgba(0,0,0,.08)";
    x.lineWidth = 10;
    ring(226);
    x.stroke();
    x.strokeStyle = "rgba(255,255,255,.7)";
    x.lineWidth = 4;
    ring(216);
    x.stroke();
    x.fillStyle = "rgba(0,0,0,.05)";
    ring(120);
    x.fill();
  });
}

function pillCanvas(a: string, b: string) {
  return draw(8, 128, (x) => {
    x.fillStyle = a;
    x.fillRect(0, 0, 8, 64);
    x.fillStyle = b;
    x.fillRect(0, 64, 8, 64);
    x.fillStyle = "rgba(0,0,0,.18)";
    x.fillRect(0, 62, 8, 3);
  });
}

function shadowCanvas() {
  return draw(256, 256, (x) => {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(40,20,0,.55)");
    g.addColorStop(0.5, "rgba(40,20,0,.18)");
    g.addColorStop(1, "rgba(40,20,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  });
}

/** A grey box with four bright panels. Rendered once into the environment map the glass reflects. */
function makeRoom(T: ThreeModule) {
  const room = new T.Scene();
  room.add(new T.Mesh(new T.BoxGeometry(30, 30, 30), new T.MeshBasicMaterial({ color: 0x8a8580, side: T.BackSide })));
  const lamp = (w: number, h: number, pos: [number, number, number], rot: [number, number, number], color: Three.Color) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color }));
    m.position.set(...pos);
    m.rotation.set(...rot);
    room.add(m);
  };
  lamp(10, 4, [0, 12, 0], [Math.PI / 2, 0, 0], new T.Color(9, 9, 9));
  lamp(4, 12, [-13, 2, 3], [0, Math.PI / 2, 0], new T.Color(5, 5.5, 6));
  lamp(3, 10, [13, 0, -2], [0, -Math.PI / 2, 0], new T.Color(3, 2.6, 2));
  lamp(8, 8, [0, -12, 0], [-Math.PI / 2, 0, 0], new T.Color(1.2, 0.9, 0.6));
  return room;
}

/**
 * Builds the scene on `canvas` and starts the render loop. `onFrame` runs once per rendered
 * frame with the current background colour, so the page can keep its own colours in step.
 */
export function createLandingScene(T: ThreeModule, canvas: HTMLCanvasElement, fonts: LabelFonts, onFrame: (bgHex: string) => void): LandingScene {
  const textures: Three.Texture[] = [];
  const tex = (c: HTMLCanvasElement) => {
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    textures.push(t);
    return t;
  };

  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = T.SRGBColorSpace;

  const scene = new T.Scene();
  const bgStops = BG_STOPS.map(([at, hex]) => [at, new T.Color(hex)] as const);
  const bgCol = new T.Color(BG_STOPS[0][1]);
  scene.background = bgCol;
  const camera = new T.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const pmrem = new T.PMREMGenerator(renderer);
  const room = makeRoom(T);
  const environment = pmrem.fromScene(room, 0.04).texture;
  scene.environment = environment;
  textures.push(environment);
  pmrem.dispose();

  const key = new T.DirectionalLight(0xfff1dc, 2.4);
  key.position.set(4, 7, 6);
  const fill = new T.DirectionalLight(0xdde8ff, 0.9);
  fill.position.set(-6, 2, 4);
  scene.add(key, fill, new T.AmbientLight(0xffffff, 0.25));

  // Bottle: open cylinder wall, base disc, rim, neck thread and a paper label.
  const glass = new T.MeshPhysicalMaterial({
    color: BOTTLE_TINT, transmission: 0.92, roughness: 0.14, metalness: 0, ior: 1.46, thickness: 0.7,
    attenuationColor: BOTTLE_TINT, attenuationDistance: 1.1, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 1.2,
  });
  const bottle = new T.Group();
  bottle.rotation.order = "ZYX";
  scene.add(bottle);
  bottle.add(new T.Mesh(new T.CylinderGeometry(1, 0.985, 3.3, 96, 1, true), glass));
  const base = new T.Mesh(new T.CircleGeometry(0.985, 96), glass);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -1.65;
  const rim = new T.Mesh(new T.TorusGeometry(0.96, 0.06, 16, 96), glass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.65;
  const thread = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 0.28, 96, 1, true), glass);
  thread.position.y = 1.78;
  const label = new T.Mesh(
    new T.CylinderGeometry(1.012, 1.012, 1.6, 64, 1, true, -1.15, 2.3),
    new T.MeshStandardMaterial({ map: tex(labelCanvas(fonts)), roughness: 0.65, metalness: 0 }),
  );
  label.position.y = -0.35;
  bottle.add(base, rim, thread, label);

  const shadowMat = new T.MeshBasicMaterial({ map: tex(shadowCanvas()), transparent: true, depthWrite: false });
  const shadow = new T.Mesh(new T.PlaneGeometry(3.4, 1.4), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const cap = new T.Group();
  scene.add(cap);
  const ridge = new T.CanvasTexture(ridgeCanvas());
  ridge.wrapS = T.RepeatWrapping;
  textures.push(ridge);
  const capSide = new T.MeshPhysicalMaterial({ color: "#ECE8E0", roughness: 0.5, bumpMap: ridge, bumpScale: 0.02, clearcoat: 0.2, clearcoatRoughness: 0.4 });
  const capTop = new T.MeshPhysicalMaterial({ map: tex(capTopCanvas()), roughness: 0.45, clearcoat: 0.2 });
  const capLiner = new T.Mesh(new T.CylinderGeometry(0.95, 0.95, 0.3, 64, 1, true), new T.MeshStandardMaterial({ color: "#d9d4ca", roughness: 0.7, side: T.BackSide }));
  capLiner.position.y = -0.35;
  cap.add(new T.Mesh(new T.CylinderGeometry(1.1, 1.1, 0.72, 128), [capSide, capTop, capSide]), capLiner);

  // Pills: six in every seven are two-tone capsules, the seventh is a flat white tablet.
  const capsuleGeo = new T.CapsuleGeometry(0.11, 0.27, 8, 20);
  const tabletGeo = new T.CylinderGeometry(0.15, 0.15, 0.06, 28);
  const capsuleMats = PILL_COLORS.map(([a, b]) => new T.MeshPhysicalMaterial({ map: tex(pillCanvas(a, b)), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
  const tabletMat = new T.MeshPhysicalMaterial({ color: "#f6f3ec", roughness: 0.55, clearcoat: 0.1 });
  const pills: Pill[] = [];
  for (let i = 0; i < PILL_COUNT; i++) {
    const tab = i % 7 === 6;
    const mesh = new T.Mesh(tab ? tabletGeo : capsuleGeo, tab ? tabletMat : capsuleMats[i % capsuleMats.length]);
    scene.add(mesh);
    const ang = rand(0, 6.28);
    const rad = rand(0, 0.78);
    pills.push({
      mesh,
      tab,
      inside: new T.Vector3(Math.cos(ang) * rad, rand(-1.45, 0.7), Math.sin(ang) * rad),
      lq: new T.Quaternion().setFromEuler(new T.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28))),
      t0: 0.34 + (i / PILL_COUNT) * 0.4 + rand(-0.02, 0.02),
      speed: rand(1.1, 2.3),
      vx: rand(-2.4, 2.6),
      vz: rand(-0.6, 0.9),
      axis: new T.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
      spin: rand(3, 8),
      floorJ: rand(0, 0.3),
      yaw: rand(0, 6.28),
      tilt: rand(-0.25, 0.25),
    });
  }

  // Reused every frame so the render loop allocates nothing.
  const scratch = new T.Object3D();
  scratch.rotation.order = "ZYX";
  const v = new T.Vector3();
  const v2 = new T.Vector3();
  const q = new T.Quaternion();
  const q2 = new T.Quaternion();
  const capEuler = new T.Euler();
  const restEuler = new T.Euler(0, 0, 0, "YXZ");

  let progress = 0;
  let time = 0;
  let last = performance.now();
  let raf = 0;
  let mobile = false;
  let visH = 0;
  let disposed = false;
  const ptr = { x: 0, y: 0 };

  const onMove = (e: PointerEvent) => {
    ptr.x = (e.clientX / innerWidth) * 2 - 1;
    ptr.y = (e.clientY / innerHeight) * 2 - 1;
  };

  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    mobile = w / h < 0.9;
    const camZ = 12.2 * Math.max(1, 0.95 / camera.aspect);
    camera.position.z = camZ;
    camera.updateProjectionMatrix();
    visH = camZ * Math.tan((camera.fov * Math.PI) / 360);
  };

  /** Places `o` where the bottle is at scroll progress `p`: upright in the hero, tipped over to pour, then lifted out of view. */
  const pose = (p: number, o: Three.Object3D) => {
    const tiltT = smoothstep(0.18, 0.48, p);
    const exitT = smoothstep(0.84, 1, p);
    const heroT = 1 - smoothstep(0, 0.2, p);
    o.position.set(
      lerp(mobile ? 0 : 1.9, mobile ? 0.35 : 0.8, tiltT),
      lerp(mobile ? -0.7 : -0.45, mobile ? 0.9 : 1.4, tiltT) + exitT * 8 + Math.sin(time * 1.1) * 0.05 * heroT,
      0,
    );
    o.rotation.set(0.12 * tiltT, time * 0.28 * heroT + (1 - heroT) * 0.35 + ptr.x * 0.12 * heroT, 1.95 * tiltT);
    o.scale.setScalar(mobile ? 0.72 : 1);
    o.updateMatrixWorld(true);
  };

  const frame = (now: number) => {
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    const max = document.documentElement.scrollHeight - innerHeight;
    const target = max > 0 ? Math.max(0, Math.min(1, scrollY / max)) : 0;
    progress += (target - progress) * (1 - Math.exp(-dt * 7));
    const p = progress;

    let i = 0;
    while (i < bgStops.length - 2 && p > bgStops[i + 1][0]) i++;
    const t = (p - bgStops[i][0]) / (bgStops[i + 1][0] - bgStops[i][0]);
    bgCol.copy(bgStops[i][1]).lerp(bgStops[i + 1][1], Math.max(0, Math.min(1, t)));

    pose(p, bottle);
    shadow.position.set(bottle.position.x, -visH + 0.05, 0);
    shadowMat.opacity = (1 - smoothstep(0.18, 0.4, p)) * 0.9;
    shadow.scale.setScalar(mobile ? 0.75 : 1);

    // Cap: unscrew, lift, then fly off to the upper right.
    const unT = smoothstep(0.08, 0.26, p);
    const flyT = smoothstep(0.22, 0.5, p);
    v.set(0, 2.02 + unT * 0.55, 0);
    bottle.localToWorld(v);
    v.x += flyT * 4.6 + flyT * flyT * 1.5;
    v.y += flyT * 3.6 - flyT * flyT * 1.2;
    v.z += flyT * 2.5;
    cap.position.copy(v);
    cap.scale.copy(bottle.scale);
    capEuler.set(flyT * 3.6, unT * Math.PI * 3 + time * 0.28 * (1 - smoothstep(0, 0.2, p)), flyT * 2.2);
    cap.quaternion.copy(bottle.quaternion).multiply(q.setFromEuler(capEuler));
    cap.visible = flyT < 1;

    // Pills: each one rides inside the bottle until its own release point t0, then follows a
    // thrown-object path from the bottle mouth down to the floor.
    const floorBase = -visH + 0.2;
    for (const pl of pills) {
      const M = pl.mesh;
      if (p < pl.t0) {
        const slide = smoothstep(pl.t0 - 0.16, pl.t0, p);
        v.set(pl.inside.x * (1 - slide * 0.6), pl.inside.y + (1.55 - pl.inside.y) * slide, pl.inside.z * (1 - slide * 0.6));
        bottle.localToWorld(v);
        M.position.copy(v);
        M.quaternion.copy(bottle.quaternion).multiply(pl.lq);
        M.scale.copy(bottle.scale);
        continue;
      }
      pose(pl.t0, scratch);
      v.set(0, 1.9, 0);
      scratch.localToWorld(v);
      v2.set(0, 1, 0).applyQuaternion(scratch.quaternion).multiplyScalar(pl.speed);
      v2.x += pl.vx;
      v2.z += pl.vz * 0.3;
      const floor = floorBase + pl.floorJ;
      const s = (p - pl.t0) * 6;
      const drop = v.y - floor;
      const sHit = (v2.y + Math.sqrt(Math.max(0, v2.y * v2.y + 2 * GRAVITY * drop))) / GRAVITY;
      const flying = s < sHit;
      const ss = flying ? s : sHit;
      const slide = flying ? 0 : Math.min(s - sHit, 0.4) * 0.6;
      M.position.set(v.x + v2.x * ss + v2.x * slide * 0.5, flying ? v.y + v2.y * ss - 0.5 * GRAVITY * ss * ss : floor, v.z + v2.z * ss * 0.3);
      q.setFromAxisAngle(pl.axis, ss * pl.spin).premultiply(scratch.quaternion).multiply(pl.lq);
      if (!flying) {
        q2.setFromEuler(restEuler.set(pl.tab ? pl.tilt : 0, pl.yaw, pl.tab ? 0 : Math.PI / 2 + pl.tilt));
        q.slerp(q2, smoothstep(0, 0.12, s - sHit));
      }
      M.quaternion.copy(q);
      M.scale.copy(scratch.scale);
    }

    // The camera drifts a little toward the pointer.
    camera.position.x += (ptr.x * 0.35 - camera.position.x) * 0.05;
    camera.position.y += (-ptr.y * 0.25 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    onFrame(`#${bgCol.getHexString()}`);
    raf = requestAnimationFrame(frame);
  };

  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("resize", resize);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
      removeEventListener("resize", resize);
      for (const root of [scene, room]) {
        root.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          o.geometry.dispose();
          for (const m of [o.material].flat()) m.dispose();
        });
      }
      for (const t of textures) t.dispose();
      renderer.dispose();
    },
  };
}
