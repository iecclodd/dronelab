# Lumina District assets and provenance

The third Explore map, `city` (Lumina District), is a ruined, burning Manhattan-style grid inside a Hollow. It uses these third-party models. All are **CC0 (public domain)** and are stored locally under `public/models`, so there are no runtime external dependencies.

| Folder | Source | License | Contents used |
|---|---|---|---|
| `public/models/city/` | [Kenney — City Kit (Commercial) 2.1](https://kenney.nl/assets/city-kit-commercial) | CC0 1.0 | building-a, e, g, i, j, l, m, n; skyscraper-a, b, d, e; `Textures/colormap.png` |
| `public/models/cars/` | [Kenney — Car Kit](https://kenney.nl/assets/car-kit) | CC0 1.0 | taxi, sedan, police, van, suv, truck, ambulance, delivery, garbage-truck, hatchback-sports, cone, box, debris-tire/door/bumper; `Textures/colormap.png` |
| `public/models/ethereals/` | [Quaternius — Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html), via [Poly Pizza](https://poly.pizza/bundle/Ultimate-Monsters-Bundle-5oyGWAmOB6) | CC0 1.0 | Goleling, Squidle, Dragon_Fly, Orc (animated, recoloured at runtime) |

Changes made in code (the files themselves are unmodified):

- **Materials.** Converted to cel-shaded toon materials.
- **Collapsed towers.** Cut with two world-space clipping planes into a V-notched break line. Their colliders are cut to the same height in `packages/contracts/city-world.ts`.
- **Ethereals.** Monsters are recoloured to void-black and neon-magenta with glowing eyes. They are scaled from their skeletons, and the Orc is the 7 m plaza brute.

All map layout, fire, smoke, ash, sky, rift, billboards and water tanks are original and procedural. The world is an homage to dense-city action games; it does not reuse any copyrighted game assets.
