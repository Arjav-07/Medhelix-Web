# MedHelix motion system

Motion tokens, the spring model, and the reusable island-navigation API. Everything
here is implemented in `assets/css/styles.css` and `assets/js/*.js`; nothing else is
required to run the page.

## Principles

1. **Motion explains a change.** Reveals, rolls and presses show what just happened.
   Nothing loops on an idle page except the live dot and the hero ECG.
2. **Compositor-friendly by default.** Animate `transform` and `opacity`. The island
   pill's `width` / `height` transitions are the one exception, kept on a small,
   isolated element so the surrounding layout is not reflowed mid-scroll.
3. **One curve, four durations.** Distance and weight pick the duration; the curve
   stays consistent so unrelated components feel like one product.
4. **Reduced motion is a first-class state.** Every token collapses to ~0ms, reveals
   render visible without transforms, counters snap, confetti is skipped, tilt and
   magnetic effects are not bound, and the custom cursor is not created.

## Tokens

Defined once on `:root` and consumed everywhere:

| Token | Value | Use |
| --- | --- | --- |
| `--dur-1` | `150ms` | Micro state: hover color, chip fill |
| `--dur-2` | `240ms` | Standard state: borders, backgrounds, link color |
| `--dur-3` | `320ms` | Component motion: icons, pills, small transforms |
| `--dur-4` | `400ms` | Larger surfaces: cards, panels, sheet items |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Default for entrances and settles |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exits only |
| `--ease-inout` | `cubic-bezier(0.65, 0, 0.35, 1)` | Position swaps with no overshoot |
| `--spring` | 26-point `linear()` curve | Anything that should feel physical |
| `--stagger` | `60ms` | General list stagger; reveal groups use `45ms` |

Reveal defaults: `640ms` fade + 22px rise, delay from `--d`; grouped children use
`560ms` + 20px with `--i * 45ms`. These are intentionally slower than UI state
changes because they carry the eye through a section entry.

### Spring model

`--spring` is sampled from a damped harmonic oscillator, not hand-tuned:

- stiffness `k = 260`, damping `c = 24`, mass `m = 1`
- natural frequency `ωn = √(k/m) ≈ 16.1 rad/s`
- damping ratio `ζ = c / (2√(km)) ≈ 0.74` (underdamped)
- first overshoot ≈ `3%`, effectively settled by `~550ms`

The `linear()` curve encodes the normalised response, which is why the island's
`560ms` width/transform transition lands with a soft overshoot instead of a linear
stop. If you retune the spring, resample the `linear()` values rather than swapping
in a bezier; the overshoot is the point.

## Timings outside CSS

| Behaviour | Timing | Notes |
| --- | --- | --- |
| Island mount | `90ms` delay, then `560ms` | Adds `.is-mounted`; bar rises 12px + 0.96 scale |
| Island compact | after `120px` scroll | Requires a `6px` direction change; expands on scroll up |
| Progress ring | every scroll frame | `requestAnimationFrame`-throttled, stroke-dashoffset |
| Digit roll | `460ms` | Old/new digit overlap; layer settles after the delay |
| Proof count-up | `1500ms` | Eased once on first reveal |
| Waitlist latency | `900ms` | Simulated network delay in the demo |
| Success focus | `80ms` | Focus moves to `.success-title` after the panel swap |
| Confetti | `900–1400ms` travel | 28 pieces, max `1800ms` before the layer is removed |

## Island navigation (`NavIsland`)

`assets/js/nav-island.js` is a classic script (no build step) that exposes
`window.NavIsland`. It auto-mounts the first `[data-island]` element; for a second
instance, construct it yourself after `counter.js` has loaded:

```html
<script defer src="assets/js/counter.js"></script>
<script defer src="assets/js/nav-island.js"></script>
<script>
  window.addEventListener("DOMContentLoaded", () => {
    const el = document.querySelector("#my-island");
    const island = new NavIsland(el);
  });
</script>
```

### Markup contract

The component reads these hooks; class names are styling-only.

| Hook | Purpose |
| --- | --- |
| `[data-island]` | Root; gets `is-mounted`, `is-compact`, `is-open` |
| `.island-bar` | Pill surface that mounts and compacts |
| `.island-links a[data-nav]` | Desktop links; `data-nav` matches a section id |
| `[data-section]` + `data-label` | Scroll-spy targets and compact label text |
| `[data-compact-label]` | Text inside the compact button |
| `.island-compact` | Button that expands the island |
| `[data-progress-ring]` | Circle whose dash offset tracks page progress |
| `.island-menu` | Mobile menu toggle |
| `.island-sheet` | Mobile sheet; made `inert` while closed |

Sections need `id`, `data-section`, and `data-label` to participate in the scroll
spy. The compact label reflects the current section, so the pill doubles as a
breadcrumb while the full links are collapsed.

### API

| Member | Behaviour |
| --- | --- |
| `new NavIsland(root)` | Binds listeners, mounts with the spring, initialises counters |
| `island.setCount(n, animate = true)` | Updates every `[data-waitlist-count]` |
| `island.expand(focusFirst = false)` | Leaves compact mode; optionally focuses active link |
| `island.closeMenu(returnFocus = false)` | Closes the mobile sheet |
| `island.toggleMenu()` | Opens or closes the mobile sheet |

The island listens for `medhelix:count` on `window`:

```js
window.dispatchEvent(
  new CustomEvent("medhelix:count", { detail: { count: 1285, animate: true } })
);
```

### Behaviour details

- Compact mode only exists above `767px`. On phones the bar is a bottom dock with
  a 44px menu button, a 44px waitlist shortcut, and the live count.
- Opening the sheet sets `aria-expanded`, swaps the menu label to “Close menu”,
  makes the sheet non-`inert`, and moves focus to the first link after `180ms`.
  `Escape` closes and returns focus; tapping outside closes without stealing focus.
- The sliding highlight uses `--hl-x`, `--hl-w`, `--hl-o` and is re-measured after
  webfonts load. The transform/width transition is `360ms var(--spring)`.

## Counters (`MedHelixCounter`)

`assets/js/counter.js` exposes `window.MedHelixCounter`:

| Member | Behaviour |
| --- | --- |
| `formatCount(n)` | `Intl.NumberFormat("en-US")`, rounded and clamped at 0 |
| `readCount(el)` | Reads `data-value`, falling back to text |
| `setCount(el, n, animate)` | Builds once, then rolls digits; snaps under reduced motion |
| `setAllCounters(n, animate)` | Applies to every `[data-waitlist-count]` |
| `initCounters()` | Builds any unbuilt counters from their markup |

Each counter keeps a visually hidden copy of the value for screen readers and marks
the animated digits `aria-hidden`, so assistive tech never hears “11,228855”.

## Reduced motion

`@media (prefers-reduced-motion: reduce)` sets all animation/transition durations to
`0.001ms`, forces reveals visible, stops the ECG dash animation, hides the cursor
ring and removes tilt transforms. JavaScript mirrors this: counters snap, confetti
returns early, and parallax/tilt/magnetic/cursor handlers are never attached.

## Files

- `index.html` — markup and critical CSS (island hooks, sections, forms)
- `assets/css/styles.css` — tokens, all component motion, reduced-motion fallback
- `assets/js/counter.js` — shared odometer counter
- `assets/js/nav-island.js` — island component and auto-mount
- `assets/js/main.js` — reveals, waitlist flow, demo, FAQ, confetti, tilt, cursor
