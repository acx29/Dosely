/**
 * 3D pill bottle built from 28 flat panels around a cylinder, spun with CSS.
 * Pure markup, no canvas or WebGL. Animation lives in globals.css (.bottle-spin)
 * and is disabled for prefers-reduced-motion.
 */
const N = 28;
const R = 42;
const STEP = 360 / N;
const SEG = 2 * R * Math.tan(Math.PI / N) + 0.7;
const RIDGES = "repeating-linear-gradient(90deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 4px)";

function panel(key: string, i: number, top: number, h: number, bg: string, z: number, extra: React.CSSProperties = {}) {
  return (
    <div
      key={key}
      style={{
        position: "absolute",
        left: "50%",
        top,
        width: SEG,
        height: h,
        marginLeft: -SEG / 2,
        transform: `rotateY(${i * STEP}deg) translateZ(${z}px)`,
        background: bg,
        backfaceVisibility: "hidden",
        ...extra,
      }}
    />
  );
}

export function PillBottle({ name, detail }: { name: string; detail?: string }) {
  const kids: React.ReactNode[] = [];
  for (let i = 0; i < N; i++) {
    const a = i * STEP;
    kids.push(panel(`body${i}`, i, 32, 150, i % 2 ? "#DA8329" : "#D07C24", R));
    kids.push(panel(`cap${i}`, i, 0, 30, i % 2 ? "#F1EEE8" : "#E9E5DD", R + 2, { backgroundImage: RIDGES }));
    if (a < 58 || a > 302) kids.push(panel(`label${i}`, i, 60, 92, "#FDFCFA", R + 1));
  }
  const D = 2 * (R + 2);

  return (
    <div aria-hidden="true" style={{ position: "relative", width: 160, height: 206 }}>
      <div
        style={{
          position: "absolute", left: "50%", bottom: 0, width: 118, height: 16, marginLeft: -59, borderRadius: "50%",
          background: "radial-gradient(closest-side, rgba(28,25,20,0.16), rgba(28,25,20,0))",
        }}
      />
      <div style={{ position: "absolute", left: "50%", top: 10, width: 150, height: 182, marginLeft: -75, perspective: 760 }}>
        <div style={{ position: "absolute", inset: 0, transform: "rotateX(-10deg)", transformStyle: "preserve-3d" }}>
          <div className="bottle-spin" style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
            {kids}
            <div
              style={{
                position: "absolute", left: "50%", top: 0, width: D, height: D, marginLeft: -D / 2, marginTop: -D / 2,
                borderRadius: "50%", background: "#EFECE5", transform: "rotateX(90deg)",
              }}
            />
            <div
              className="font-mono"
              style={{
                position: "absolute", left: "50%", top: 64, width: 64, height: 84, marginLeft: -32,
                transform: `translateZ(${R + 2.5}px)`, backfaceVisibility: "hidden", boxSizing: "border-box",
                padding: "6px 7px", textAlign: "left", color: "#4A3A1C",
              }}
            >
              <div style={{ height: 4, background: "#147A57", borderRadius: 2, marginBottom: 5 }} />
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.08em" }}>Rx ONLY</div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", marginTop: 4, color: "#2B2417" }}>{name.toUpperCase()}</div>
              {detail ? <div style={{ fontSize: 7, marginTop: 2 }}>{detail}</div> : null}
              <div style={{ height: 3, background: "#E2DCCF", borderRadius: 2, marginTop: 7 }} />
              <div style={{ height: 3, background: "#E2DCCF", borderRadius: 2, marginTop: 4, width: "80%" }} />
              <div style={{ height: 3, background: "#E2DCCF", borderRadius: 2, marginTop: 4, width: "60%" }} />
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute", left: "50%", top: 12, width: 84, height: 178, marginLeft: -42, borderRadius: 10, pointerEvents: "none",
          background: "linear-gradient(90deg, rgba(255,255,255,0) 14%, rgba(255,255,255,0.38) 30%, rgba(255,255,255,0) 54%)",
        }}
      />
    </div>
  );
}
