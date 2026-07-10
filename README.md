# Planificateur de Road Trip

**Live app:** [road-planner-brown.vercel.app](https://road-planner-brown.vercel.app/)

A tool for planning multi-day work trips between agencies — built for screen
installation/preparation rounds ("préparateur chantier double écrans"), but
useful for any job that means visiting a list of sites in the most sensible
order, over one or more days, by car.

It puts your stops on a map, works out driving legs and times between them,
tracks which agencies you've already visited, and tallies up how many
replacement screens you'll need to bring based on what's currently on the
wall at each stop.

## What it does

- **Multi-day itineraries** — split a trip into as many days as you need,
  each with its own list of stops and its own color on the map.
- **Route calculation** — enter or search for addresses and the app works
  out the driving legs between them (distance/time per leg).
- **Agency markers on the map** — every known agency shows up as a colored
  dot:
  - 🟣 **Purple** — not yet visited
  - 🟢 **Green** — already visited
  - 🔵 **Blue** — currently part of the trip (added as a stop on any day)
  Hover a marker to see its address, visited status, and the screens
  currently installed there.
- **Two ways to click a marker** (toggle in the header):
  - **Ajouter comme étape** — clicking an agency adds it as the next stop
    on the active day.
  - **Basculer visité** — clicking an agency just flips its visited/not
    visited status, without touching the itinerary.
- **Screen tally** — for every agency currently used as a stop anywhere in
  the trip, the app aggregates the screens on-site by brand/model and works
  out how many new screens need to be brought, both trip-wide and per
  agency.
- **Light/dark mode**, with the map re-tinted to match.
- **Works on mobile** — the map is full-screen by default; the planner and
  screen-tally panels tuck away as swipe-up/down sheets so they're out of
  the way until you need them.

## How to use it

1. **Open the live app**: [road-planner-brown.vercel.app](https://road-planner-brown.vercel.app/)
2. **Add your stops for Day 1**: type an address into a stop field and pick
   it from the autocomplete suggestions, or click an agency marker on the
   map (in "Ajouter comme étape" mode) to add it as the next stop.
3. **Calculate the route**: hit the calculate button to draw the driving
   legs on the map and see distance/time per leg.
4. **Add more days** with the "+" tab if the trip spans multiple days —
   each day gets its own tab and its own route color.
5. **Check the screen tally**: once agencies are on your itinerary, the
   left-hand (or, on mobile, top) panel shows the total screens by
   brand/model and how many new units to bring, updated automatically as
   you add or remove stops.
6. **Mark agencies as visited** as you go, either by switching the click
   mode to "Basculer visité" and tapping the marker, or from the
   itinerary itself.
7. **Toggle dark mode** from the button next to the theme switch in the
   header if you're planning at night or just prefer it.

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [Leaflet](https://leafletjs.com/) for the map, with OpenStreetMap tiles
- Deployed on [Vercel](https://vercel.com/)

## Running it locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

```bash
npm run build   # production build
npm start       # run the production build locally
```