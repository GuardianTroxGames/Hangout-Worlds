# Hangout Worlds

A 3D multiplayer hangout with three maps (Golden Hour Plaza, Frostlight Lake, Sunstone Ruins) and four modes (Hangout, Orb Rush, Ice Tag, Ring Race).

## Run locally
    node server.js
Open http://localhost:3000 in two browser tabs to see yourself in both. Needs Node 18+. There is nothing to install.

## Put it online
The multiplayer needs a host that keeps a Node process running with WebSocket support. Static-only hosts (GitHub Pages, Netlify, Vercel static) cannot run it.

1. Upload these files to a GitHub repo.
2. Create a **Web Service** on Render, Railway, Fly.io or similar.
   - Build command: leave empty (or `npm install`)
   - Start command: `node server.js`
3. Open the URL it gives you. Add your own domain in the host's "Custom domain" settings. HTTPS and secure WebSockets (wss) work automatically.

## Optional settings (environment variables)
- `PORT`: set automatically by most hosts.
- `MAX_CLIENTS`: default 60 players at once.
- `ALLOWED_ORIGIN`: e.g. `https://yourdomain.com` to refuse connections from other sites.

## Hosting the page and server separately
Put `index.html` on any static host and set `const WS_URL='wss://your-server.example.com/ws'` near the top of its script. Set `ALLOWED_ORIGIN` on the server to your page's address.

## Notes
- Chat and positions are relayed live and never stored.
- The server only accepts known fields with limited ranges and rate-limits each player.
- Orb Rush and Ring Race scores are counted in each player's browser, so they can be faked. Fine for friends, not for prizes.
