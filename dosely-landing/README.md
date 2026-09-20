# Dosely landing page

Scroll-driven landing page: 3D pill bottle (three.js, WebGL) that opens and pours as you scroll, then lands on a sign-in card. Includes the black/red heartbeat loading screen, shown on first load and again for 2.5s on every exit (Sign in, Google/Microsoft, Run the demo).

## Files
- index.html      the page (markup in <x-dc>, logic in the <script data-dc-script> class, tweak props in data-props)
- support.js      the small runtime that renders the template. Keep next to index.html.
- fonts/          Geist, Geist Mono, Goudy Bookletter 1911 (all OFL)
- Dosely Landing (standalone).html   single file, everything inlined, works offline except three.js

## Run
Serve the folder over http (fonts and three.js will not load from file:// in most browsers):
    npx serve .        or        python3 -m http.server
three.js is loaded from unpkg at runtime, so the page needs network the first time.

## Where things go
- Sign-in / SSO / demo buttons call go(url) in the logic class. Change the URLs there:
    'dashboard.html'                 after sign in
    'uploads/dosely-landing.html#demo' Run the demo
- Scroll timeline lives in pose() and frame(); bottle tint and pill count are in data-props.
