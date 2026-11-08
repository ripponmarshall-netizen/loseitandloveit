// Penguin mascots as inline SVG strings, animated by CSS in styles.css (.pg-*).
// One source for both the pre-JS splash (injected into index.html by a tiny
// plugin in vite.config.js) and the React loaders. Colours come from CSS
// variables, so they follow light/dark mode. Static, trusted markup only.

const face = (dx = 0) => `
    <path class="pg-white" d="M${100 + dx} 70c-12-8-28-4-28 12 0 12 12 18 28 18s28-6 28-18c0-16-16-20-28-12z"/>
    <g class="pg-eyes">
      <circle class="pg-ink" cx="${88 + dx}" cy="82" r="4.6"/><circle class="pg-ink" cx="${112 + dx}" cy="82" r="4.6"/>
      <circle class="pg-glint" cx="${89.6 + dx}" cy="80.4" r="1.5"/><circle class="pg-glint" cx="${113.6 + dx}" cy="80.4" r="1.5"/>
    </g>
    <circle class="pg-cheek" cx="${79 + dx}" cy="92" r="5"/><circle class="pg-cheek" cx="${121 + dx}" cy="92" r="5"/>
    <path class="pg-beak" d="M${93 + dx} 90h14l-7 9z"/>`

const body = `
    <path class="pg-body" d="M100 52c30 0 46 26 48 60 2 34-16 60-48 60s-50-26-48-60c2-34 18-60 48-60z"/>
    <ellipse class="pg-white" cx="100" cy="128" rx="32" ry="40"/>`

export const PENGUIN_WORKOUT = `<svg class="pg pg-workout" viewBox="0 0 200 200" role="img" aria-label="Penguin lifting weights">
  <defs><linearGradient id="pgw-halo" x1="0" y1="0" x2="1" y2="1"><stop class="pg-halo-a" offset="0"/><stop class="pg-halo-b" offset="1"/></linearGradient></defs>
  <circle cx="100" cy="104" r="90" fill="url(#pgw-halo)"/>
  <ellipse class="pg-shadow" cx="100" cy="181" rx="46" ry="6"/>
  <ellipse class="pg-beak" cx="80" cy="176" rx="15" ry="6"/><ellipse class="pg-beak" cx="120" cy="176" rx="15" ry="6"/>
  <g class="pg-lift">
    <g class="pg-bar">
      <rect class="pg-steel" x="20" y="33" width="160" height="6" rx="3"/>
      <rect class="pg-plate-a" x="24" y="19" width="13" height="34" rx="4"/><rect class="pg-plate-b" x="39" y="24" width="8" height="24" rx="3"/>
      <rect class="pg-plate-a" x="163" y="19" width="13" height="34" rx="4"/><rect class="pg-plate-b" x="153" y="24" width="8" height="24" rx="3"/>
    </g>
    <path class="pg-body" d="M64 104c-12-18-12-46-4-64 3-5 10-4 10 3 0 18 2 38 8 54z"/>
    <path class="pg-body" d="M136 104c12-18 12-46 4-64-3-5-10-4-10 3 0 18-2 38-8 54z"/>
    ${body}
    ${face()}
    <path class="pg-band" d="M71 67c16-11 42-11 58 0l-2 7c-16-9-38-9-54 0z"/>
    <path class="pg-band" d="M127 69l14-7-1 11z"/>
    <path class="pg-drop" d="M146 62c3 5 5 8 5 11a5 5 0 0 1-10 0c0-3 2-6 5-11z"/>
  </g>
</svg>`

export const PENGUIN_THINKING = `<svg class="pg pg-thinking" viewBox="0 0 200 200" role="img" aria-label="Penguin thinking">
  <defs><linearGradient id="pgt-halo" x1="0" y1="0" x2="1" y2="1"><stop class="pg-halo-a" offset="0"/><stop class="pg-halo-b" offset="1"/></linearGradient></defs>
  <circle cx="96" cy="108" r="86" fill="url(#pgt-halo)"/>
  <ellipse class="pg-shadow" cx="100" cy="181" rx="44" ry="6"/>
  <ellipse class="pg-beak" cx="82" cy="176" rx="14" ry="6"/><ellipse class="pg-beak" cx="118" cy="176" rx="14" ry="6"/>
  <g class="pg-sway">
    <path class="pg-body" d="M56 110c-10 14-12 34-4 46 3 4 9 2 9-3 0-14 2-28 6-40z"/>
    ${body}
    <g class="pg-head">${face()}</g>
    <path class="pg-body pg-chin" d="M141 104C152 120 134 128 112 106C106 100 110 93 116 95C124 98 133 99 141 104Z"/>
  </g>
  <g class="pg-bubbles">
    <circle class="pg-bubble b1" cx="140" cy="60" r="4"/>
    <circle class="pg-bubble b2" cx="152" cy="45" r="6"/>
    <g class="pg-cloud">
      <rect class="pg-bubble" x="136" y="8" width="58" height="28" rx="14"/>
      <circle class="pg-dot d1" cx="152" cy="22" r="3.6"/><circle class="pg-dot d2" cx="165" cy="22" r="3.6"/><circle class="pg-dot d3" cx="178" cy="22" r="3.6"/>
    </g>
  </g>
</svg>`

// Head only, static: for the Coach tab, the "ask" bar and chat avatars.
export const PENGUIN_FACE = `<svg class="pg pg-face" viewBox="0 0 40 40" aria-hidden="true">
  <circle class="pg-body" cx="20" cy="20.5" r="18"/>
  <path class="pg-white" d="M20 12.6c-3.2-2.6-9.4-1.8-9.4 4.6 0 5.8 4.6 10 9.4 10s9.4-4.2 9.4-10c0-6.4-6.2-7.2-9.4-4.6z"/>
  <circle class="pg-ink" cx="16" cy="18.4" r="2"/><circle class="pg-ink" cx="24" cy="18.4" r="2"/>
  <circle class="pg-glint" cx="16.7" cy="17.7" r="0.7"/><circle class="pg-glint" cx="24.7" cy="17.7" r="0.7"/>
  <circle class="pg-cheek" cx="12.6" cy="22" r="1.9"/><circle class="pg-cheek" cx="27.4" cy="22" r="1.9"/>
  <path class="pg-beak" d="M17.4 21.4h5.2l-2.6 3.4z"/>
</svg>`
