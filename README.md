# Wack MyGuyVR

A browser-based 3D ragdoll physics sandbox. Build a character, put their name over their head, and test every tool in the box on them.

## Files

- `index.html` – page layout and script tags
- `style.css` – the black, grey and purple interface
- `script.js` – the 3D simulator: renderer, physics, character and face generator, tools, worlds, sound, in-game UI and session saving
- `menu.css` / `menu.js` – the main menu (START, RESUME, SETTINGS), kept separate from the simulator. The menu talks to the game only through `window.WMG`

- `og-image.png` – the 1200×630 preview card Discord shows in the embed
- `og-icon.png`, `favicon.svg` – the site icon
- `play-single-file.html` – the whole game in one file

Characters, textures, environments and sound effects are generated in `script.js`, so there is no asset folder.

## Run it

You need an internet connection the first time, because three.js and cannon.js load from cdnjs.

**Quickest:** double-click `index.html`.

**Recommended (local server):**

```
cd wack-myguyvr
python3 -m http.server 8000
```

Then open http://localhost:8000. Or use `npx serve` if you have Node.js.

**GitHub Pages:** push the three files to a repository, open Settings → Pages, and choose the branch.

## Discord embed

The page already has the tags Discord reads: title, a purple side bar and a large preview image. The MyGuyVR description is part of the image itself, so the embed has no separate description text. Discord only builds embeds from a real hosted address, so:

1. Host the folder, for example on GitHub Pages.
2. The tags already point at `https://vocql.github.io/wackmyguyvr/`. If you move the site, update every `og:` and `twitter:` URL in `index.html` and `worstday.html`.
3. `index.html`, `worstday.html`, `og-image.png` and `og-worstday.png` must sit at the **root of the repo**, not inside a `wack-myguyvr/` subfolder. Check this by opening `https://vocql.github.io/wackmyguyvr/og-image.png` in a browser: it should show the card.
4. Push the change and send the link in Discord as a new message.

Discord caches previews. If an old link shows no embed, send it again with `?v=2` on the end (for example `https://vocql.github.io/wackmyguyvr/?v=2`). Also check that embeds are on: User Settings → Chat → "Show embeds and preview website links".

A claude.ai artifact link will always show Claude's own preview instead of yours.

## MYGUYVR WORST DAY EVER (`worstday.html`)

A page where MyGuyVR's Discord profile card (`myguyvr-card.png`, also embedded in the page) gets wrecked. Open it from the **💣 Worst Day Ever** button in the game's top bar, or go straight to `worstday.html`. The old `pfp.html` link redirects here.

| Tool | Key | What it does |
|---|---|---|
| Bomb | 1 | Blows a jagged, burnt hole with scorch marks. Pieces fly off like paper, flip to show white backs and pile up on the floor |
| Mega bomb | 2 | Shatters the whole card |
| Fire | 3 | Click and drag to char the card until it burns through, with flames and ash |
| Splat | 4 | Splatters paint with drips |
| Stamp | 5 | Slams a red WORST DAY EVER stamp on it |
| Shred it | S | Feeds the card through the Shred-O-Matic into paper strips |
| Fresh card | R | Brings the card back |

The Mood meter climbs from Chillin’ to Bad day, Terrible and finally WORST DAY EVER. It has its own Discord preview (`og-worstday.png`).

## Realistic 3D models (GTA-style characters)

The built-in dummies are sculpted in code. For game-quality characters, open **Creator → Realistic 3D model** and upload a rigged humanoid `.glb`. The ragdoll drives the model's skeleton, so it gets punched, blown up and gets back up like any other dummy.

**Getting a model (free):**

1. Pick a character on mixamo.com (free Adobe account) and download it as **FBX**, T-pose, no animation.
2. In Blender, use File → Import → FBX, then File → Export → **glTF 2.0**, format **glTF Binary (.glb)**.
3. Upload the `.glb` in the Creator.

**Other models:** Any humanoid rig with standard bone names works. That includes Mixamo, Unity/VRM-style (`LeftUpperArm`, `LeftLowerLeg`…) and `upperarm_l`-style rigs. Only use models whose licence allows it.

**Saving:** Uploaded models are stored in your browser (IndexedDB), so saved sessions and library characters keep them on that device. Files up to 80 MB are accepted, but lighter models (under about 20 MB) run much better.

## Main menu and saving

- **START** opens a fresh session in your chosen starting world.
- **RESUME** reloads your last session: the world, every dummy with its custom look and name, and your Wack points. It stays disabled until a session has been saved.
- **SETTINGS** covers audio (volume, sound effects), graphics (quality, frame rate counter) and gameplay (starting world, getting back up, name tags, slow motion, camera follow, auto-save).
- While you play, the session auto-saves every few seconds and whenever you leave the page. The ⌂ button in the top bar saves and returns to the menu.
- Everything is stored in your browser's local storage on this device.

## Character models

Characters are sculpted and textured in code, in the style of early-2000s open-world games:

- Realistic proportions, with a shaped torso, hips, biceps, calves and knees.
- Hands with four fingers and a thumb.
- Painted fabric textures:
  - denim with orange stitching and worn knees;
  - creased trousers;
  - print shirts;
  - tracksuit stripes;
  - a security uniform with pockets and a badge.
- Real garment shapes: collars, short sleeves, blazer lapels, skirts and dresses.
- Sneakers with white soles, dress shoes and heels.
- Hats: cap, beanie, peaked cap and sun hat.
- A painted face texture adds eye-socket shading and cheek colour under the 3D features.

## Performance

- Each dummy part is baked into one mesh per material, which cuts draw calls by about 80%.
- Physics runs at a fixed 60 Hz, with sphere-chain limbs and sleeping props.
- Resolution adapts automatically: if the frame rate drops below about 48 fps, the render scale steps down until it is smooth again.
- If it still stutters, set Quality to Low in Settings. That turns off shadows and trims particles.

## Controls

| Input | Action |
|---|---|
| Left click | Use the selected tool |
| Right drag (or Alt + drag) | Orbit the camera |
| Mouse wheel | Zoom |
| 1–9, 0, −, = | Switch tools |
| Space | Pause and resume |
| R | Reset dummies |
| F | Select the next dummy |
| C | Open the character creator |
| N | Toggle name tags |
| Q / E, arrow keys | Rotate the camera |
| Touch | One finger uses the tool, two fingers orbit and pinch to zoom |

## Credits

- three.js r128 (MIT)
- cannon.js 0.6.2 (MIT)
- Chakra Petch and Bangers fonts (Google Fonts, SIL Open Font License)
