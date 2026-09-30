# FPV-first DroneLab: research and design brief

This brief translates established FPV simulator patterns into an original browser-game direction for DroneLab. The cited product features are verified from official product pages or game-published announcements; recommendations below are design inferences, not claims of measured usability or flight validation.

## Patterns from FPV games

| Game | Verified product patterns | Design implication for DroneLab |
|---|---|---|
| [Liftoff](https://www.liftoff-game.com/liftoff-fpv-drone-racing) | Offers Free Flight, Race and Freestyle, tutorials/controller setup, environment variety, and track/race building. Its [beginner guidance](https://www.liftoff-game.com/support?category=1&post=44&topic=3) suggests easy self-set goals, practicing in Free Flight/Freestyle before racing, and quick reset/rewind. | Begin with relaxed flight and small optional goals; make retries immediate and let racing follow exploration. |
| [Uncrashed](https://store.steampowered.com/app/1682970/Uncrashed/) | Promotes large, varied maps for freestyle/race practice, multiplayer and community maps. Its [developer tips and updates](https://steamcommunity.com/app/1682970/announcements/) recommend open, low-obstacle areas for beginners, then gradual progression toward tighter lines; updates describe adjustable camera tilt. | Stage the map from a forgiving practice area to increasingly precise flight lines. |
| [The Drone Racing League Simulator](https://store.steampowered.com/app/641780) | Its interactive training teaches FPV maneuvers and controls; replays help pilots improve race lines and lap times. It includes real league tracks, custom course creation, multiplayer and leaderboards. [Official announcements](https://steamcommunity.com/app/641780/announcements/) also describe onboarding and explorable maps. | Teach through brief in-world exercises, then use replayable routes and personal bests as the mastery loop. |
| [TRYP FPV](https://store.steampowered.com/app/1881200/TRYP_FPV_Drone_Racer_Simulator/) | Presents large realistic maps, a minimap for finding locations and making flight lines, cinematic flying around activities, and location-specific precision challenges. Its [developer announcements](https://steamcommunity.com/app/1881200/allnews/) describe race-line/gate guidance and new challenges. | Treat navigation and inventing a line through a place as gameplay; optional challenges can give structure without closing off free flight. |

These references support a core loop of **fly freely → discover a landmark or line → try an optional precision challenge → review a ghost/personal best → fly again**. They do not establish a single best control scheme for a browser game.

## Original DroneLab implementation brief

Build **Aster Valley**, a compact, open **400 × 400 m** playground with a clear takeoff point and multiple flight lines. Use a small set of legible destinations: a safe airfield, container freestyle yard, canyon arch, viaduct, tower and forest. Give each area a recognizable silhouette and at least one approach, gap or loop that rewards a different line. A minimap and visible home marker should make it easy to orient and return.

Make the flight view the default experience: full-screen FPV, a choice between **Assisted** and **Acro**, visible camera-tilt and field-of-view settings, and a quick respawn. Mouse input should be explicitly understandable: pointer lock or drag-to-look for camera look, with a clear recenter/exit affordance; keep view-look independent from flight axes. Do not imply that mouse look itself controls drone pitch, roll or throttle. Offer an accessible keyboard/gamepad path where supported.

Keep the world readable and honest at gameplay speed. Local geometry should determine collision, occlusion and visible gaps; preserve performance with a modest number of well-placed landmarks rather than distant detail that cannot be reached or collided with. Start with broad safe space and optional short goals (hover, reach a landmark, pass through a wide gap), then introduce timed gates, ghosts or personal-best routes. Keep the **AI Lab secondary** to flying and exploration.

The environmental design direction is an inference informed by [Riders Republic’s world-building account](https://www.ubisoft.com/en-au/game/riders-republic/news-updates/5I9IJDdoVEpxAPpdTcamo1/building-the-world-of-riders-republic), which discusses distinct geology/biomes, landmarks and dedicated stunt spots. For camera framing references, [BETAFPV’s AIR65 frame listing](https://betafpv.com/products/air65-brushless-whoop-frame) gives a 25–50° camera-angle range for a low-profile canopy, and [DJI Avata 2](https://www.dji.com/avata-2) markets an immersive wide FPV perspective. These are reference points only; they do not validate DroneLab’s camera values, physics or fidelity to real aircraft.

## Boundaries

Use these games as evidence for interaction patterns, not as sources for copied layouts, art or assets. This brief specifies an original stylized playground; it makes no claim to AAA visual quality or validated real-drone simulation. The linked product descriptions establish advertised features, not independent performance or usability results.
