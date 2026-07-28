# Beijing Trip Visual Editor

Files:
- `index.html` public bilingual/trilingual itinerary + Leaflet map
- `admin.html` visual editor (drag stops, edit names/coordinates, add/delete)
- `data/itinerary.json` source of truth
- `netlify/functions/save-itinerary.mjs` writes JSON back to GitHub
- `netlify.toml` Netlify config

## Deploy
1. Create a GitHub repository and upload the contents of this folder (not the outer ZIP folder).
2. In Netlify: Add new project → Import an existing project → GitHub → select the repository.
3. No build command is required. Publish directory is `.`.
4. In Netlify → Site configuration → Environment variables, add:
   - `GITHUB_TOKEN`
   - `GITHUB_OWNER`
   - `GITHUB_REPO`
   - `GITHUB_BRANCH` = `main`
5. The GitHub token should be a fine-grained token limited to this repository with **Contents: Read and write**.
6. Open `/admin.html`, edit, drag rows, then click **Save & Publish**.
7. The function commits `data/itinerary.json` to GitHub. Netlify sees the commit and redeploys.

## Important security note
Do not put a GitHub token in `admin.html` or any browser JavaScript.

The included function supports an optional `ADMIN_KEY`, but the current editor does not expose a login UI for it. Before making `/admin.html` publicly discoverable, add authentication (for example Netlify-compatible auth/access control) or extend the editor to send the secret securely through an authenticated session. A secret typed into browser code is not equivalent to real authentication.
