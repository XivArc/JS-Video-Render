# Canvas Video Studio

Preview Canvas JavaScript animations and export H.264 MP4 or MOV directly in
your browser. The website runs on the device opening it, with a queue of up to
10 animation files, automatic error skipping, Canvas argument repair, and
verified video bitrate.

## Publish with GitHub Pages

1. Create a GitHub repository named `js-video-renderer`, using the `main` branch.
   GitHub Free supports Pages with a public repository.
2. Upload this project's contents to the repository root. Include `src`,
   `.github/workflows/deploy.yml`, `index.html`, `vite.config.js`,
   `package.json`, and `package-lock.json`. Upload the extracted files rather
   than the ZIP or a containing folder. Do not upload `node_modules` or videos.
3. In the repository, open **Settings → Pages** and select **GitHub Actions**
   under **Build and deployment → Source**.
4. Open **Actions → Deploy Canvas Video Studio to GitHub Pages → Run workflow**.
   Choose `main` and run it. Future commits to `main` deploy automatically.
5. When the workflow succeeds, open the published website URL shown in the
   deployment or **Settings → Pages**. Bookmark that URL.

You do not need CMD, Node.js, or a local development server to use the published
website. The workflow installs the locked dependencies and builds the site on
GitHub. The Pages base path is detected automatically, so repository names,
account root sites, and custom-domain root sites use the correct asset URLs.

The render itself runs in the browser. Keep its tab open until the queue
finishes. Animation files and output videos stay on the device; the website
does not send them to a rendering server or commit them to GitHub.

The first render loads the bundled FFmpeg assets, including approximately
32 MB of WebAssembly. Later loads can use the browser's normal HTTP cache.
Network access is needed to load the website; this package does not add an
offline installation or a service worker.

For detailed Indonesian setup instructions, see `SETUP_GITHUB_PAGES_ID.txt`.

## Render settings

| Auto Random mode | Resolution | Verified video bitrate |
| --- | --- | --- |
| 4K (2160p) | 3840 × 2160 | 70–100 Mbps |
| 2K (1440p) | 2560 × 1440 | 53–68 Mbps |
| FHD (1080p) | 1920 × 1080 | 40–51 Mbps |
| HD (720p) | 1280 × 720 | 20–38 Mbps |

Each file gets a fresh random target. Every output is inspected before download
or saving. Green checks identify completed files; red checks identify failed
files and show their errors. A failure automatically advances to the next file.

Choose full animation for each source's own duration, or a 2/5-second test clip.
The chosen dimensions, frame rate, format, and bitrate profile apply to the
whole queue. Download completed files from their rows, or choose a folder when
the browser supports it. Selecting a new queue or rendering again replaces
the earlier download results. Download videos you want to keep first.

See `README.txt` for the animation API, encoding limits, auto-repair behavior,
font licenses, and validation details.

## Optional local development

Use Node.js 24. Run `npm ci`, then `npm run dev`. The same source continues to
work locally. `npm run build` creates a root-path static site by default.
GitHub's deployment workflow supplies `GITHUB_PAGES_BASE_PATH` during build.

This project uses single-threaded FFmpeg.wasm and requires a browser with
OffscreenCanvas, Worker, and WebAssembly on HTTPS or localhost.

## Pre-deployment validation

The packaged source passed a fresh `npm ci`, a default-root build, and a build
under `/js-video-renderer/`. The subfolder build was tested in Chromium using
a static server with no SPA fallback and no cross-origin isolation headers.
FFmpeg, its WebAssembly core, animation workers, CSS, and fonts all loaded from
the deployed subfolder without external requests.

Real HD MP4 exports and an FHD MOV export passed independent H.264, resolution,
frame count, duration, and video-stream bitrate checks. A malformed animation
failed while the following file completed. The 390-pixel layout had no
horizontal overflow. These are local production-build checks; they do not
confirm a deployment on your GitHub account.

## Deployment troubleshooting

- **Configure GitHub Pages fails / site not found:** select GitHub Actions in
  Settings → Pages, then rerun the workflow.
- **No workflow appears:** confirm `.github/workflows/deploy.yml` was uploaded
  at the repository root and committed on `main`.
- **Blank page / missing assets:** publish through the included workflow rather
  than serving the unbuilt `src` directory. Confirm the latest workflow passed.
- **Browser shows an old version:** wait for deployment to complete, then
  refresh with Ctrl+F5.
- **An animation fails:** its row shows the source error; the queue continues.
  Correct the animation file and select it again.

Documentation:
- https://vite.dev/guide/static-deploy
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
