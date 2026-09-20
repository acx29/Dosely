"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createLandingScene, loadLabelFonts, smoothstep, type LandingScene } from "@/lib/landing-scene";

// Sign-in is a stub for the demo. Nothing is checked: every sign-in control opens the dashboard.
const DASHBOARD_HREF = "/doctor/performance";
// "Run the demo" opens Recall activity, the screen with the "Run recall now" button.
const DEMO_HREF = "/doctor/recall";

const OVERLAY_BG = "#171717";
const OVERLAY_FADE_MS = 300;
// The heartbeat line takes 2.5s to draw from left to right. The route change starts when it is fully drawn.
const EXIT_MS = 2500;

const STATS = [
  { value: "412", label: "overdue patients found in one practice" },
  { value: "141", label: "visits booked, nobody approved a queue" },
  { value: "4.5×", label: "the 31 patients expected to return on their own" },
];

const GUTTER = "px-[clamp(20px,4vw,48px)]";
const SSO = "h-[42px] cursor-pointer rounded-lg border border-line-2 bg-white text-[14px] font-medium text-ink hover:bg-subtle";
const INPUT = "h-[42px] rounded-lg border border-line-2 bg-white px-3 text-[15px] font-normal text-ink outline-green placeholder:text-[#8a857c]";

// Pending reset of the <body> background after the page unmounts. Module-level so a remount can cancel it.
let bodyReset: ReturnType<typeof setTimeout> | undefined;

export function Landing() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const beatARef = useRef<HTMLElement>(null);
  const beatBRef = useRef<HTMLElement>(null);
  const signRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<LandingScene | null>(null);
  const exiting = useRef(false);
  const exitTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    clearTimeout(bodyReset);
    let alive = true;
    let scene: LandingScene | null = null;
    let reveal: ReturnType<typeof setTimeout> | undefined;
    let lastBg = "";
    const timers = exitTimers.current;

    // Each section fades and shifts by its distance from the middle of the viewport.
    const fadeSections = () => {
      const vh = innerHeight;
      const hero = heroRef.current;
      if (hero) {
        hero.style.opacity = String(1 - smoothstep(0, vh * 0.55, scrollY));
        hero.style.transform = `translateY(${-scrollY * 0.15}px)`;
      }
      for (const el of [beatARef.current, beatBRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const d = (r.top + r.height / 2 - vh / 2) / (vh * 0.42);
        el.style.opacity = String(Math.max(0, 1 - d * d));
        el.style.transform = `translateY(${d * 40}px)`;
      }
      const sign = signRef.current;
      if (sign) {
        const t = smoothstep(vh * 0.9, vh * 0.2, sign.getBoundingClientRect().top);
        sign.style.opacity = String(t);
        sign.style.transform = `translateY(${(1 - t) * 60}px)`;
      }
    };

    // The scene changes its background colour with scroll. Copy it to --bg (page background and the
    // nav button text) and to <body>, which is the colour the browser shows when scrolling past either end.
    const onFrame = (bgHex: string) => {
      if (bgHex !== lastBg && !exiting.current) {
        lastBg = bgHex;
        wrapRef.current?.style.setProperty("--bg", bgHex);
        document.body.style.backgroundColor = bgHex;
      }
      fadeSections();
    };

    (async () => {
      try {
        const [T, fonts] = await Promise.all([import("three"), loadLabelFonts()]);
        if (!alive || !canvasRef.current) return;
        scene = sceneRef.current = createLandingScene(T, canvasRef.current, fonts, onFrame);
      } catch (err) {
        // No WebGL, or the three.js chunk failed to load. The text and the sign-in card work without the bottle.
        console.error("landing scene failed to start", err);
      }
      if (alive) reveal = setTimeout(() => setLoading(false), 400);
    })();

    return () => {
      alive = false;
      clearTimeout(reveal);
      timers.forEach(clearTimeout);
      scene?.dispose();
      sceneRef.current = null;
      // Leave <body> dark a little longer: the dashboard fades in on top of it (.fade-in in globals.css).
      bodyReset = setTimeout(() => {
        document.body.style.backgroundColor = "";
      }, 600);
    };
  }, []);

  const go = (href: string) => {
    if (exiting.current) return;
    exiting.current = true;
    setSigningIn(true);
    setLoading(true);
    document.body.style.backgroundColor = OVERLAY_BG;
    router.prefetch(href);
    exitTimers.current.push(
      // Once the overlay is opaque the scene is hidden, so stop rendering it.
      setTimeout(() => sceneRef.current?.dispose(), OVERLAY_FADE_MS),
      // router.push keeps this page, and so the overlay, on screen until the dashboard's data has loaded.
      setTimeout(() => router.push(href), EXIT_MS),
    );
  };

  const signIn = () => go(DASHBOARD_HREF);
  const runDemo = (e: React.MouseEvent) => {
    e.preventDefault();
    go(DEMO_HREF);
  };

  return (
    <div ref={wrapRef} className="relative min-h-screen bg-(--bg) leading-[normal] text-white [--bg:#1f3864]">
      <div
        aria-hidden={!loading}
        className={`fixed inset-0 z-9 flex flex-col items-center justify-center gap-2 bg-[#171717] transition-[opacity,visibility] duration-300 ${loading ? "" : "invisible opacity-0"}`}
      >
        <div className="relative flex h-[206px] w-full max-w-[550px] items-center justify-center">
          <svg viewBox="0 0 550 206" fill="none" className="absolute h-auto w-full max-w-[550px]">
            {/* The key remounts the path on exit, so the line starts drawing from the left again. */}
            <path
              key={signingIn ? "exit" : "intro"}
              d="M0 103H150L172 103L188 52L204 154L220 103H240L254 82L268 124L282 103H550"
              pathLength={814}
              stroke="#e5383b"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="heartbeat"
            />
          </svg>
        </div>
        <div className="font-wordmark text-[40px] leading-none">Dosely</div>
      </div>

      <canvas ref={canvasRef} className="fixed inset-0 z-0 block h-full w-full" />
      <div className="pointer-events-none fixed inset-0 z-1 bg-[radial-gradient(ellipse_at_50%_45%,rgba(0,0,0,0)_50%,rgba(0,0,0,.30)_100%)]" />

      <nav className={`fixed inset-x-0 top-0 z-3 flex items-center justify-between gap-4 py-[18px] ${GUTTER}`}>
        <a href="#top" className="font-wordmark text-[30px] leading-none hover:opacity-80">
          Dosely
        </a>
        <div className="flex items-center gap-[10px]">
          <Link
            href={DEMO_HREF}
            onClick={runDemo}
            className="inline-flex h-[38px] items-center whitespace-nowrap rounded-full border border-white/78 px-[14px] text-[14px] font-medium hover:opacity-80"
          >
            Run the demo
          </Link>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
            className="h-[38px] cursor-pointer whitespace-nowrap rounded-full bg-white px-4 text-[14px] font-medium text-(--bg)"
          >
            Sign in
          </button>
        </div>
      </nav>

      <main className="pointer-events-none relative z-2">
        <section id="top" ref={heroRef} className={`grid min-h-screen grid-cols-2 items-center pb-12 pt-24 ${GUTTER}`}>
          <div className="flex min-w-0 flex-col gap-[22px]">
            <div className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[.08em] text-white/78">
              <span className="inline-block h-2 w-2 rounded-full bg-current" />
              Agentic therapy starts for provider networks
            </div>
            <h1 className="font-wordmark text-[clamp(84px,14vw,200px)] leading-[.9] tracking-[-.02em]">Dosely</h1>
            <p className="max-w-[24em] text-pretty text-[clamp(18px,1.6vw,24px)] leading-[1.35] text-white/78">
              Your overdue patients, back on the schedule. One call, one text, one visit every six months.
            </p>
            <div className="mt-[14px] flex items-center gap-3 font-mono text-[12px] tracking-[.06em] text-white/78">
              <span className="inline-block h-px w-11 bg-current" />
              Scroll to open the bottle
            </div>
          </div>
          <div className="min-h-[40vh]" />
        </section>

        <div className="h-[80vh]" />
        <section ref={beatARef} className={`flex min-h-screen items-center justify-center text-center ${GUTTER}`}>
          <div className="flex max-w-[820px] flex-col items-center gap-5">
            <h2 className="text-balance font-wordmark text-[clamp(44px,7vw,104px)] leading-none tracking-[-.015em]">Take one visit every six months.</h2>
            <p className="max-w-[34em] text-pretty text-[clamp(16px,1.4vw,20px)] text-white/78">
              Dosely finds the patients who quietly fell out of care, reaches them in your practice&apos;s name, and books the visit straight onto your
              calendar.
            </p>
          </div>
        </section>

        <div className="h-[60vh]" />
        <section ref={beatBRef} className={`flex min-h-screen items-center justify-center ${GUTTER}`}>
          <div className="grid w-full max-w-[1040px] grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[clamp(24px,5vw,72px)]">
            {STATS.map((s) => (
              <div key={s.value} className="flex flex-col gap-[10px]">
                <div className="font-mono text-[clamp(56px,7vw,112px)] font-medium leading-none tracking-[-.04em] tabular-nums">{s.value}</div>
                <div className="text-[16px] text-white/78">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="h-screen" />
        <section ref={signRef} className={`pointer-events-auto flex min-h-screen items-center-safe justify-center pb-10 pt-20 ${GUTTER}`}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              signIn();
            }}
            className="flex w-full max-w-[400px] flex-col gap-[14px] rounded-[18px] bg-[#fdfcfa] p-[26px] text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,.55),0_1px_0_rgba(255,255,255,.4)]"
          >
            <div className="flex flex-col gap-1.5">
              <div className="font-wordmark text-[34px] leading-none text-blue-dk">Dosely</div>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-.02em]">Sign in to your practice</h2>
              <p className="text-[14px] text-ink-2">Recall runs every morning. Come see what got booked.</p>
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={signIn} className={SSO}>
                Continue with Google
              </button>
              <button type="button" onClick={signIn} className={SSO}>
                Continue with Microsoft
              </button>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[.08em] text-ink-2">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              <span>Work email</span>
              <input type="email" autoComplete="email" placeholder="you@practice.com" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              <span className="flex justify-between">
                <span>Password</span>
                <a href="#" onClick={(e) => e.preventDefault()} className="font-normal text-green hover:opacity-80">
                  Forgot?
                </a>
              </span>
              <input type="password" autoComplete="current-password" placeholder="••••••••" className={INPUT} />
            </label>
            {signingIn ? (
              <div className="flex h-[46px] items-center justify-center rounded-lg bg-green text-[15px] font-medium text-white">Signed in. Opening your practice…</div>
            ) : (
              <button type="submit" className="h-[46px] cursor-pointer rounded-lg bg-ink text-[15px] font-medium text-white hover:bg-ink-3">
                Sign in
              </button>
            )}
            <p className="text-center text-[13px] text-ink-2">
              No account yet?{" "}
              <Link href={DEMO_HREF} onClick={runDemo} className="font-medium text-green hover:opacity-80">
                Run the live demo →
              </Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
