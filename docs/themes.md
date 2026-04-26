# eJay UI Themes

Color palette reference for implementing per-product UI themes. Each entry
describes the visual language of the original application, lists extracted or
inferred hex values, and maps them to DaisyUI/CSS custom property names for
future use in `src/app.css`.

Sources: direct screenshot analysis for all 13 products.
All entries are screenshot-verified.

---

## How to Apply a Theme

Each theme maps to the DaisyUI dark-theme tokens currently defined in
`src/app.css`. A product-specific theme would override these variables on a
`[data-theme="<product>"]` root attribute:

| Variable | Role |
|---|---|
| `--color-base-100` | Page/window background |
| `--color-base-200` | Panel and card surfaces |
| `--color-base-300` | Nested surfaces, borders, hover states |
| `--color-base-content` | Default text |
| `--color-primary` | Primary accent (active, play, selected) |
| `--color-secondary` | Secondary accent (stop, warn, destructive) |
| `--color-accent` | Tertiary decorative accent |
| `--channel-loop` | Sample block color — Loop / Drum / Bass |
| `--channel-effect` | Sample block color — Effect / Voice / Scratch |
| `--channel-keys` | Sample block color — Keys / Guitar |
| `--channel-xtra` | Sample block color — Xtra / Hyper / Wave / Groove |
| `--font-sans` | UI font family |

---

## Default — Sound Browser (current) ✅ default

**Visual language:** The current browser application theme defined in
`src/app.css`. Near-black background with a very slight blue tint. Neon
green primary accent, teal secondary, and blue accent. All sample channel
blocks use a unified family of cool periwinkle-blues, with per-channel
variants defined individually (--channel-drum, --channel-bass, etc.).

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#050608` | Near-black with faint blue tint |
| `--color-base-200` | `#0b0d12` | Panel surface |
| `--color-base-300` | `#171922` | Borders and nested surfaces |
| `--color-base-content` | `#f2f1ec` | Near-white warm text |
| `--color-primary` | `#3dff89` | Neon green primary accent |
| `--color-secondary` | `#0f8e88` | Teal secondary accent |
| `--color-accent` | `#4e8ee8` | Blue accent |
| `--channel-loop` | `#6aa6ff` | Periwinkle-blue (Loop) |
| `--channel-drum` | `#5f9cf0` | Periwinkle-blue (Drum) |
| `--channel-bass` | `#5f9cf0` | Periwinkle-blue (Bass) |
| `--channel-guitar` | `#6da8ff` | Periwinkle-blue (Guitar) |
| `--channel-keys` | `#66a7ff` | Periwinkle-blue (Keys) |
| `--channel-sequence` | `#66a7ff` | Periwinkle-blue (Sequence) |
| `--channel-voice` | `#78a9ff` | Periwinkle-blue (Voice) |
| `--channel-effect` | `#7aa7ee` | Periwinkle-blue (Effect) |
| `--channel-scratch` | `#78a9ff` | Periwinkle-blue (Scratch) |
| `--channel-orchestral` | `#7aa7ee` | Periwinkle-blue (Orchestral) |
| `--channel-pads` | `#6ca3f2` | Periwinkle-blue (Pads) |
| `--channel-extra` | `#6f9ce0` | Periwinkle-blue (Extra) |
| `--channel-unsorted` | `#5e7cab` | Muted blue-grey (Unsorted) |

---

## Dance eJay 1 (1997) ✅ screenshot-verified

**Visual language:** Screenshot-verified. The most visually striking eJay UI:
a vivid red/fire-flame outer frame dominates the entire chrome border, making
the arranger look like it's set inside a burning engine. The arranger grid
itself is a dark navy-blue with a subtle dot pattern. Sample blocks are
highly varied and saturated — vivid green, cobalt blue, hot pink/magenta,
cyan, red, and pale yellow. The sample browser panel uses warm orange-amber
cells. The "Dance eJay" wordmark is a yellow-gold gradient. Channel buttons
at the bottom-left are blue pill-shapes (Loop, Bass, Layer, Voice, Effect /
Drum, Sequence, Xtra, Rap, Wave). Track number indicators on the left are
green squares.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0a1428` | Dark navy-blue arranger grid, screenshot-verified |
| `--color-base-200` | `#121e34` | Panel surface |
| `--color-base-300` | `#1a2840` | Borders and nested surfaces |
| `--color-base-content` | `#dce8f8` | Cool blue-white text |
| `--color-primary` | `#cc2200` | Deep red/fire frame, screenshot-verified |
| `--color-secondary` | `#dd2288` | Hot pink/magenta sample blocks, screenshot-verified |
| `--color-accent` | `#e8c030` | Yellow-gold logo gradient, screenshot-verified |
| `--channel-loop` | `#33cc33` | Vivid green rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#dd2288` | Hot pink tonal/vocal blocks, screenshot-verified |
| `--channel-keys` | `#2255dd` | Cobalt blue melodic blocks, screenshot-verified |
| `--channel-xtra` | `#00ccdd` | Cyan atmospheric blocks, screenshot-verified |
| `--font-sans` | `"Orbitron", sans-serif` | Geometric sci-fi, matches robot/machine aesthetic |

---

## Dance eJay 2 / Dance eJay 2: Techno Edition (1999) ✅ screenshot-verified

**Visual language:** Screenshot-verified. The orange-flame chrome frame is the
defining visual shift from Dance eJay 1's red frame — same burning texture
language, warmer hue. The arranger grid is a very dark near-black navy. Sample
blocks are varied and vivid: cream-yellow, pink/salmon, red, periwinkle blue,
cyan, and green. The sample browser uses warm amber cells. Transport controls
have a gold-amber ring around dark navy buttons. Channel pills at the bottom
(Loop, Drum, Bass, Guitar, Seq, Layer / Rap, Voice, Effect, Xtra, GrooveG,
Wave) are dark blue-grey. The "440" badge and orange "e-Jay" logo appear in the
right sidebar. This orange-frame visual language carries through Dance eJay 3
and Dance eJay 4.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0e0e18` | Dark charcoal-blue |
| `--color-base-200` | `#16162a` | Panel surface |
| `--color-base-300` | `#20203c` | Borders and nested surfaces |
| `--color-base-content` | `#d8d8ec` | Default text |
| `--color-primary` | `#2060ff` | Electric blue primary accent |
| `--color-secondary` | `#e04080` | Pink/red secondary accent |
| `--color-accent` | `#8844ff` | Violet Hyper Generator accent |
| `--channel-loop` | `#e8c030` | Yellow-amber rhythmic blocks |
| `--channel-effect` | `#e04080` | Pink tonal/vocal blocks |
| `--channel-keys` | `#2060ff` | Electric blue melodic blocks |
| `--channel-xtra` | `#8844ff` | Violet atmospheric/Hyper blocks |
| `--font-sans` | `"Exo 2", sans-serif` | Futuristic condensed, matches Hyper Generator orange-flame |

---

## Dance eJay 3 (2000) ✅ screenshot-verified

**Visual language:** Screenshot-verified. Same orange-flame chrome frame and
dark navy arranger grid as Dance eJay 2, confirming the continuous lineage.
Block colors are notably more pastel and washed out compared to DE2: salmon-peach
rather than hot pink, pale cream-yellow rather than vivid amber, and soft
periwinkle/sky-blue for stereo L/R track pairs. The "Dance eJay 3" wordmark is
yellow bottom-left. Channel buttons bottom-right (LOOP, RAP, DRUM, VOICE, BASS,
EFFECT, GUITAR, XTRA, KEYS, LAYER, GROOVE, WAVE) have small orange/red LED dots.
The BPM display is a blue pill (`#2255cc`). Sample browser uses the same warm
amber cells as DE2.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#080e1e` | Dark navy arranger grid, screenshot-verified |
| `--color-base-200` | `#10182a` | Panel surface |
| `--color-base-300` | `#18243a` | Borders and nested surfaces |
| `--color-base-content` | `#dce8f8` | Cool blue-white text |
| `--color-primary` | `#cc4400` | Orange-flame frame, screenshot-verified |
| `--color-secondary` | `#e8a090` | Salmon-peach sample blocks, screenshot-verified |
| `--color-accent` | `#d08820` | Warm amber browser cells, screenshot-verified |
| `--channel-loop` | `#f0ea98` | Pale cream-yellow rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#e8a090` | Salmon-peach tonal/vocal blocks, screenshot-verified |
| `--channel-keys` | `#9ab0d0` | Soft periwinkle melodic blocks, screenshot-verified |
| `--channel-xtra` | `#b0c8e8` | Sky-blue stereo/atmospheric blocks, screenshot-verified |
| `--font-sans` | `"Rajdhani", sans-serif` | Softer futuristic, matches the more pastel DE3 aesthetic |

---

## Dance eJay 4 (2001) ✅ screenshot-verified

**Visual language:** Screenshot-verified. A complete visual redesign from the
DE1–3 orange/red-flame lineage. The outer chrome frame shifts to **magenta-
purple**, giving the UI a modern early-2000s look. The arranger grid remains
dark navy but the transport oval is a bold purple-mauve with teal/cyan buttons;
the "DANCE4" wordmark is rendered in teal. The bottom mixer section uses a
dark purple-mauve fader strip panel. Sample blocks are vivid and saturated:
hot pink/magenta for long melodic rows, cyan-sky for wide combi blocks, vivid
green for mid-range hits, orange-red for percussion, and gold-yellow for solo
instrument blocks. Right sidebar icon buttons are teal with bright green LED
indicators. This is arguably the most colourful and densely saturated of all
Dance eJay releases.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0a1428` | Dark navy arranger grid, screenshot-verified |
| `--color-base-200` | `#12203a` | Panel surface |
| `--color-base-300` | `#1a2c4c` | Borders and nested surfaces |
| `--color-base-content` | `#dce8f8` | Cool blue-white text |
| `--color-primary` | `#bb2288` | Magenta-purple frame, screenshot-verified |
| `--color-secondary` | `#00cccc` | Teal transport buttons/wordmark, screenshot-verified |
| `--color-accent` | `#9030a0` | Purple-mauve transport oval, screenshot-verified |
| `--channel-loop` | `#ee44aa` | Hot pink/magenta melodic blocks, screenshot-verified |
| `--channel-effect` | `#dd4422` | Orange-red percussion blocks, screenshot-verified |
| `--channel-keys` | `#40b8e0` | Cyan-sky combi blocks, screenshot-verified |
| `--channel-xtra` | `#44cc44` | Vivid green hit blocks, screenshot-verified |
| `--font-sans` | `"Audiowide", sans-serif` | Electronic music display, matches magenta-purple early-2000s look |

---

## Rave eJay (1998) ✅ screenshot-verified

**Visual language:** Screenshot-verified. Near-black background with a faint
blue tint, chrome metallic transport bar, sci-fi machine/robot art backdrop.
Sample blocks are warm and heavily saturated — yellow-amber, hot pink, orange,
teal/cyan. Category tabs use cyan with green LED indicators. Despite the "Rave"
branding the background is dark, not sky-blue — the rave aesthetic is
expressed through the vivid saturated sample block colors rather than the
background tone.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0a0a0f` | Near-black with faint blue tint, screenshot-verified |
| `--color-base-200` | `#12121a` | Panel surface |
| `--color-base-300` | `#1c1c28` | Borders and nested surfaces |
| `--color-base-content` | `#d8d8e8` | Default text |
| `--color-primary` | `#00d4ff` | Cyan category tab accent, screenshot-verified |
| `--color-secondary` | `#e45090` | Hot pink stop/warn accent, screenshot-verified |
| `--color-accent` | `#28c8b0` | Teal decorative glow |
| `--channel-loop` | `#e8c430` | Yellow-amber rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#e45090` | Hot pink tonal/vocal blocks, screenshot-verified |
| `--channel-keys` | `#00d4ff` | Cyan melodic blocks, screenshot-verified |
| `--channel-xtra` | `#28c8b0` | Teal atmospheric blocks |
| `--font-sans` | `"Electrolize", sans-serif` | Clean electronic mono-style, matches rave tech near-black aesthetic |

---

## Techno eJay (1999) ✅ screenshot-verified

**Visual language:** Screenshot-verified. Darker blue UI compared to Rave eJay,
with a more modern and polished look. Dark navy background, cleaner layout,
sample blocks in muted and desaturated pinks, blues, and teals. Warm amber/yellow
browser bubbles in the sample panel. More restrained, less raw than the Rave
aesthetic — conveys a harder, more mechanical techno character.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0d1a2e` | Dark navy, screenshot-verified |
| `--color-base-200` | `#162236` | Panel surface |
| `--color-base-300` | `#1e2e44` | Borders and nested surfaces |
| `--color-base-content` | `#dce4f0` | Cool blue-white text |
| `--color-primary` | `#4488cc` | Steel-blue primary accent, screenshot-verified |
| `--color-secondary` | `#e08090` | Muted warm pink secondary, screenshot-verified |
| `--color-accent` | `#e0a840` | Amber browser bubble accent, screenshot-verified |
| `--channel-loop` | `#e0a840` | Warm amber rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#e08090` | Muted pink tonal/vocal blocks, screenshot-verified |
| `--channel-keys` | `#60a0d0` | Soft blue melodic blocks, screenshot-verified |
| `--channel-xtra` | `#70b890` | Muted teal atmospheric blocks |
| `--font-sans` | `"Michroma", sans-serif` | Angular mechanical letterforms, matches dark navy muted techno |

---

## Techno 3 (2002) ✅ screenshot-verified

**Visual language:** Screenshot-verified. Playful, youthful, and extremely
energetic. Bright hot-pink/magenta geometric patterned background,
vivid teal sample blocks, electric purple, orange, and warm amber browser
bubbles. A complete tonal reversal from Techno eJay 1999 — clearly targeting a
younger mainstream audience.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#cc2266` | Hot pink/magenta patterned BG |
| `--color-base-200` | `#aa1a55` | Deeper panel pink |
| `--color-base-300` | `#881144` | Borders and nested surfaces |
| `--color-base-content` | `#fff0f8` | Near-white text |
| `--color-primary` | `#00cccc` | Vivid teal primary accent |
| `--color-secondary` | `#ff4499` | Bright pink secondary |
| `--color-accent` | `#9933ff` | Electric purple accent |
| `--channel-loop` | `#e8b840` | Warm amber rhythmic blocks |
| `--channel-effect` | `#ff4499` | Bright pink tonal blocks |
| `--channel-keys` | `#00cccc` | Vivid teal melodic blocks |
| `--channel-xtra` | `#9933ff` | Electric purple atmospheric blocks |
| `--font-sans` | `"Fredoka One", sans-serif` | Rounded bubbly, matches hot pink playful youthful aesthetic |

---

## HipHop eJay 1 / GenerationPack1 (1999) ✅ screenshot-verified

**Visual language:** Screenshot-verified. Very dark navy-blue arranger grid with a
strikingly warm gold/amber metallic border framing the lower sample panel — the
non defining characteristic of this UI. Sample blocks are vivid yellow-amber and
hot pink/magenta on the dark grid. Channel indicators in the bottom-right panel
use yellow-green (LOOP), orange (BASS), green (KEYS/GUITAR), red
(EFFECTS/VOICE), and pink/lavender (RAP). Transport controls are silver chrome.
The eJay logo is rendered in gold. Despite the hip-hop branding the background
is dark navy rather than warm black — the warmth is concentrated in the gold
panel frame.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0d1525` | Very dark navy-blue, screenshot-verified |
| `--color-base-200` | `#16202e` | Panel surface |
| `--color-base-300` | `#1e2c3e` | Borders and nested surfaces |
| `--color-base-content` | `#dce8f0` | Cool blue-white text |
| `--color-primary` | `#c89030` | Rich gold panel frame, screenshot-verified |
| `--color-secondary` | `#dd3080` | Hot pink/magenta secondary, screenshot-verified |
| `--color-accent` | `#a07020` | Deep amber gold decorative |
| `--channel-loop` | `#e8c030` | Yellow-amber rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#dd3080` | Hot pink tonal/vocal blocks, screenshot-verified |
| `--channel-keys` | `#44aa44` | Green melodic blocks (channel indicator), screenshot-verified |
| `--channel-xtra` | `#cc5500` | Orange bass/atmospheric indicator, screenshot-verified |
| `--font-sans` | `"Bebas Neue", sans-serif` | Bold condensed display, classic late-90s hip-hop title aesthetic |

---

## HipHop eJay 2 (2000) ✅ screenshot-verified

**Visual language:** Screenshot-verified. The warm gold/brass metallic frame is
continuous with HipHop eJay 1, confirming this as the defining HipHop eJay
chrome language. The arranger grid is dark navy (slightly lighter than HH1).
Block colors are much more varied than HH1: vivid green rows alternate with
salmon-peach, orange-gold, pale lavender-grey, teal-aqua, and yellow-cream
blocks. The right sidebar retains the gold/wood texture with "440" badge and
"NEW" sticker. Channel buttons left (Loop, Drum, Bass, Keys, Guitar, Xtra) are
dark pills; right channel buttons (Rap, Voice, FX, Wave, Record, Groove) have
orange LED dot indicators.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0d1830` | Dark navy grid, screenshot-verified |
| `--color-base-200` | `#162038` | Panel surface |
| `--color-base-300` | `#1e2c48` | Borders and nested surfaces |
| `--color-base-content` | `#dce8f8` | Cool blue-white text |
| `--color-primary` | `#c89030` | Rich gold/brass frame, screenshot-verified |
| `--color-secondary` | `#e89070` | Salmon-peach sample blocks, screenshot-verified |
| `--color-accent` | `#e8a040` | Orange-gold accent blocks, screenshot-verified |
| `--channel-loop` | `#44cc44` | Vivid green rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#e89070` | Salmon-peach tonal/vocal blocks, screenshot-verified |
| `--channel-keys` | `#40a8b0` | Teal-aqua melodic blocks, screenshot-verified |
| `--channel-xtra` | `#9090c0` | Pale lavender atmospheric blocks, screenshot-verified |
| `--font-sans` | `"Anton", sans-serif` | Bold urban display, matches gold-frame hip-hop poster energy |

---

## HipHop eJay 3 (2001) ✅ screenshot-verified

**Visual language:** Screenshot-verified. A complete departure from the gold/brass
frame of HH1 and HH2. The chrome has shifted to a near-black background with
deep red/crimson accent borders — all REC, SOLO/MUTE buttons and transport
highlights use saturated orange-red. The bottom panel is dark charcoal with
orange-red bordered EQ, Compressor, and Stereowide panels. Channel buttons
bottom-right (LOOP, LADIES, DRUM, FELLAS, BASS, FX, KEYS, XTRA, GUITAR,
RECORD, WAVE, GROOVE) are orange pill-shapes. The eJay logo appears gold
bottom-right of the transport. Sample blocks are varied: orange-amber with
star texture, sky-blue, hot pink-red, teal-blue, and muted sage-green.
Transport buttons are silver-grey metallic.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0a0808` | Very dark near-black grid, screenshot-verified |
| `--color-base-200` | `#141010` | Panel surface |
| `--color-base-300` | `#201818` | Borders and nested surfaces |
| `--color-base-content` | `#e8e0d8` | Warm off-white text |
| `--color-primary` | `#cc3300` | Deep red/crimson frame accent, screenshot-verified |
| `--color-secondary` | `#dd4400` | Orange-red button highlight, screenshot-verified |
| `--color-accent` | `#e8a040` | Orange-amber star-block accent, screenshot-verified |
| `--channel-loop` | `#e8a040` | Orange-amber rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#dd3355` | Hot pink-red tonal/vocal blocks, screenshot-verified |
| `--channel-keys` | `#60b0e0` | Sky-blue melodic blocks, screenshot-verified |
| `--channel-xtra` | `#4090b0` | Teal-blue atmospheric blocks, screenshot-verified |
| `--font-sans` | `"Black Ops One", sans-serif` | Military stencil, matches crimson-red aggressive no-gold aesthetic |

---

## HipHop eJay 4 (2003) ✅ screenshot-verified

**Visual language:** Screenshot-verified. The most visually unique HipHop
release — and arguably the most monochromatic UI of any eJay product. The
entire interface uses a gritty aged-metal / rust-concrete dark brown texture
as the background, evoking warehouse walls and urban decay. The arranger grid
is very dark near-black with a subtle gritty texture. Sample blocks are almost
uniformly **orange-amber** with white figure/person icons — there is effectively
a single block color across all tracks, with almost no variety. The sample
browser continues the same orange-amber with figure icons throughout.
Transport controls are dark metallic spheres with an orange play button. REC
circles are orange. The "HipHop" wordmark is a light grey hand-lettered graffiti
style bottom-left. The right sidebar has dark circular icon buttons with orange
accents and a gold "eJay" logo. This earthy, monochrome palette is a radical
departure from all previous HipHop releases.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#0c0a08` | Very dark gritty near-black grid, screenshot-verified |
| `--color-base-200` | `#1a1208` | Aged-metal brown panel surface, screenshot-verified |
| `--color-base-300` | `#2a1e0e` | Rust-brown textured border, screenshot-verified |
| `--color-base-content` | `#e8dcc8` | Warm cream text |
| `--color-primary` | `#e87820` | Orange-amber (dominant block color), screenshot-verified |
| `--color-secondary` | `#c85c10` | Darker orange-brown secondary |
| `--color-accent` | `#c8a060` | Warm gold logo accent, screenshot-verified |
| `--channel-loop` | `#e87820` | Orange-amber rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#e87820` | Orange-amber tonal/vocal blocks (uniform), screenshot-verified |
| `--channel-keys` | `#e87820` | Orange-amber melodic blocks (uniform), screenshot-verified |
| `--channel-xtra` | `#c85c10` | Darker orange-brown variant, screenshot-verified |
| `--font-sans` | `"Permanent Marker", cursive` | Hand-lettered marker, matches the graffiti "HipHop" wordmark |

---

## Xtreme eJay (2001) ✅ screenshot-verified

**Visual language:** Screenshot-verified. The neon-green extreme-sports guess
was entirely wrong. Xtreme eJay is a dark industrial grey aesthetic — sombre,
gritty, and monochromatic. The background is very dark charcoal with a concrete
texture. All panel headers (Equalizer, Echo, Chorus, Reverb, Midisweep,
Overdrive) use deep red labels. The bottom category tab pills (BEATS, BASS,
KEYS, GUITAR, EFFECTS, XTRA, VOICES, SAMPLES, VIDEO) and BPM genre labels
(HIP HOP, TECHNO, DRUM'N'BASS, ALTERNATIVE) are all red. The sample browser
cells are warm olive-gold. A grunge skateboard/action-sports photomontage in
red and grey fills the left panel. The "eJay 360 Xtreme" logo is red with a
chrome silver "360". Fader strips and transport are metallic grey with red
highlights. There is no neon green anywhere.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#141414` | Very dark charcoal, screenshot-verified |
| `--color-base-200` | `#1e1e1e` | Panel surface |
| `--color-base-300` | `#2a2a2a` | Borders and nested surfaces |
| `--color-base-content` | `#c8c8c8` | Light grey text |
| `--color-primary` | `#cc1111` | Deep red panel headers/tabs, screenshot-verified |
| `--color-secondary` | `#aa0e0e` | Darker red variant |
| `--color-accent` | `#c8a020` | Olive-gold sample cells, screenshot-verified |
| `--channel-loop` | `#c8a020` | Olive-gold rhythmic blocks, screenshot-verified |
| `--channel-effect` | `#cc1111` | Red effect/label accent, screenshot-verified |
| `--channel-keys` | `#909090` | Mid-grey melodic blocks |
| `--channel-xtra` | `#606060` | Dark grey atmospheric blocks |
| `--font-sans` | `"Teko", sans-serif` | Condensed bold, extreme sports action feel |

---

## House eJay (2007) ✅ screenshot-verified

**Visual language:** Screenshot-verified. The most commercially polished release
in the archive. Mid-tone steel blue-grey arranger grid, dark navy header bar,
the "HOUSE eJay" logo in a red/orange gradient. Sample blocks are a uniform
medium-dark blue. Transport control strip is light silver-grey. Right panel
buttons are crimson red. Channel tabs at the bottom use dark navy. Clean,
functional, and contemporary — more akin to mid-2000s music software than the
raw neon aesthetic of earlier titles.

| Role | Hex | Notes |
|---|---|---|
| `--color-base-100` | `#1a2a3c` | Dark navy header/window chrome |
| `--color-base-200` | `#4a6080` | Mid steel-blue grid area |
| `--color-base-300` | `#3a5070` | Panel borders and nested surfaces |
| `--color-base-content` | `#e8eef8` | Light blue-white text |
| `--color-primary` | `#cc3311` | Red/orange logo gradient start |
| `--color-secondary` | `#8090a0` | Silver-grey transport controls |
| `--color-accent` | `#5a7090` | Track control steel grey |
| `--channel-loop` | `#3a5878` | Uniform medium-dark blue blocks |
| `--channel-effect` | `#3a5878` | Uniform medium-dark blue blocks |
| `--channel-keys` | `#3a5878` | Uniform medium-dark blue blocks |
| `--channel-xtra` | `#3a5878` | Uniform medium-dark blue blocks |
| `--font-sans` | `"Montserrat", sans-serif` | Clean geometric, matches mid-2000s commercially polished look |

> **Note:** House eJay uses a single uniform blue for all sample block types,
> unlike earlier titles which color-coded blocks by channel category.

---

## Summary Table

| Product | Year | Background | Primary Accent | Character | Evidence |
|---|---|---|---|---|---|
| **Default (Sound Browser)** | — | `#050608` near-black | `#3dff89` neon green | Near-black, neon green, unified blue blocks | ✅ **default** |
| Dance eJay 1 | 1997 | `#0a1428` dark navy grid | `#cc2200` red/fire frame | Red flame frame + vivid blocks | ✅ screenshot |
| Dance eJay 2 | 1999 | `#080e1e` dark navy grid | `#cc4400` orange-flame frame | Orange flame frame + vivid blocks | ✅ screenshot |
| Dance eJay 3 | 2000 | `#080e1e` dark navy grid | `#cc4400` orange-flame frame | Pastel blocks, 16 tracks | ✅ screenshot |
| Dance eJay 4 | 2001 | `#0a1428` dark navy grid | `#bb2288` magenta-purple frame | Magenta-purple redesign, teal accents | ✅ screenshot |
| Rave eJay | 1998 | `#0a0a0f` near-black | `#00d4ff` cyan | Dark rave, saturated blocks | ✅ screenshot |
| Techno eJay | 1999 | `#0d1a2e` dark navy | `#4488cc` steel-blue | Darker, muted tones | ✅ screenshot |
| Techno 3 | 2002 | `#cc2266` hot pink | `#00cccc` vivid teal | Playful youthful pop | ✅ screenshot |
| HipHop eJay 1 | 1999 | `#0d1525` dark navy | `#c89030` gold frame | Dark navy + gold frame, vivid blocks | ✅ screenshot |
| HipHop eJay 2 | 2000 | `#0d1830` dark navy | `#c89030` gold frame | Gold frame, varied vivid blocks | ✅ screenshot |
| HipHop eJay 3 | 2001 | `#0a0808` near-black | `#cc3300` red/crimson frame | Red-crimson frame, no gold | ✅ screenshot |
| HipHop eJay 4 | 2003 | `#0c0a08` dark gritty near-black | `#e87820` orange-amber (uniform) | Rust-texture, monochromatic blocks | ✅ screenshot |
| Xtreme eJay | 2001 | `#141414` dark charcoal | `#cc1111` deep red | Dark industrial grey + red, olive-gold cells | ✅ screenshot |
| House eJay | 2007 | `#1a2a3c` dark navy | `#cc3311` red/orange | Contemporary steel-blue | ✅ screenshot |
