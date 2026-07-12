# 🐾 PERCY — A Cat's Big Day Out

A cozy 3D adventure game. You are **Percy**, a gray-brown tabby cat with one mission:
get from your bedroom, out the window, across gardens, a dog's yard, a busy street,
rolling fields, a stream and a dark forest — all the way to the lake pier, and catch
**3 fish**. Without using up all nine lives.

**Play:** open `index.html` on any static host (or the Vercel deployment).

## Features

- Fully procedural 3D world & animated cat built with Three.js — zero downloaded assets
- Cat-feel movement: sprint, double-jump ("cat twist"), auto-mantle, wall/fence/tree climbing, swimming
- Hazards: traffic (fatal), a chasing dog, deep water, fall damage
- HP, XP + levels, 9 lives, checkpoints with autosave (localStorage), death & respawn flow
- Pickups: fish snacks (+HP), milk (full heal), yarn balls (+XP)
- Fishing pounce minigame finale at the pier
- Procedurally synthesized audio: generative music, ambience, meows, purrs, honks, barks
- Golden-hour lighting, sky shader, particles, butterflies, fireflies, ducks, birds
- Pause menu, settings (volumes, sensitivity, quality, invert-Y, cat coat), title/death/win screens
- Desktop (pointer lock) + touch controls (virtual joystick); responsive to any screen size

## Controls

| Input | Action |
|---|---|
| WASD / Arrows | Move |
| Mouse | Look |
| Space | Jump / double-jump / pounce (at the pier) |
| Shift | Sprint |
| Hold toward fences & trees | Climb |
| M | Meow |
| Esc / P | Pause |

## Development

No build step. Serve the repo root with any static server:

```bash
npx serve .
```

Three.js is vendored in `/vendor` (MIT — see `vendor/THREE-LICENSE`).

## Deploy

Static site — deploys as-is on Vercel (auto-deploys on push via the connected GitHub repo).
