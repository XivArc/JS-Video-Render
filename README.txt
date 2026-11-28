CANVAS VIDEO STUDIO — GITHUB PAGES, BATCH RENDER, AND VERIFIED BITRATE

A complete Vite project ready for GitHub Pages or your existing local renderer.
All interface labels, help text, progress messages, and errors are in English.

PUBLISH THE ONLINE WEBSITE
Follow README.md or SETUP_GITHUB_PAGES_ID.txt in this package.
Upload the complete project to your GitHub repository, select GitHub Actions
in Settings -> Pages, and run the included deployment workflow.
The source includes package.json, package-lock.json, and the workflow file.
Once published, open the website URL directly. No local CMD or development
server is needed for everyday use. Rendering continues to use the browser's
device, with the existing queue, auto-repair, and verified bitrate behavior.

GITHUB PAGES BUILD VALIDATION
The complete package passed a fresh npm ci and production builds for the root
path and /js-video-renderer/. A strict static-server browser test loaded all
FFmpeg, WebAssembly, worker, CSS, and font assets from the subfolder.
Real HD MP4 and FHD MOV video-stream bitrates passed their selected ranges.
A failed animation was skipped and the next file rendered successfully.
These tests validate the build locally; publication still requires uploading
the project and enabling GitHub Pages on your repository.

UPDATE AN EXISTING LOCAL PROJECT (OPTIONAL)
1. Extract the ZIP.
2. Copy the complete src folder, index.html, and vite.config.js into:
   I:\Data Arkaan\Vibe Code\js-video-renderer
   Merge the src folder with the existing folder and replace matching files.
   Include src/render-queue.js, src/canvas-auto-repair.js, src/bitrate-profiles.js, and the complete
   src/fonts folder. Copy the whole src folder to include every dependency.
   Keep index.html and vite.config.js in the project root.
3. If Vite is already running, refresh the browser with Ctrl+F5.
   If Vite has stopped, run these commands in CMD:
     cd /d "I:\Data Arkaan\Vibe Code\js-video-renderer"
     npm run dev
4. Open the Local URL shown by Vite.

No additional npm packages are needed for an existing local installation.
The ZIP includes package.json and package-lock.json for GitHub's automatic
build; these do not need replacing in your unchanged local project.
node_modules and generated videos are excluded.

BATCH RENDER — UP TO 10 FILES
1. Click Choose JavaScript files.
2. Select up to 10 .js files in the file picker. On Windows, use Ctrl or Shift
   to select several files. Each file may be up to 5 MB.
3. Choose your bitrate mode, frame rate, format, and duration.
4. Click Render N videos to start. Files run one at a time in the displayed order.
5. Download each completed video from its row under Render Status.

The Render queue shows every filename and its state:
- Waiting: the file has not started.
- Rendering: this file is active, with a rotating indicator.
- Completed: a green check appears after verification and successful saving.
- Failed: a red check appears with the error message. The next file starts
  automatically, including when the first file cannot load or a later frame fails.
- Cancelled: the file was interrupted or was waiting when the queue stopped.
Each file uses a fresh animation worker and encoder so an error does not reuse
the failed animation's worker for the next file.

Export settings apply to all selected files. Full animation uses each source's
own duration. A quick test uses the shorter of that file's duration and the
selected test length. Frame rate, dimensions, format, and bitrate profile are
shared. Each file gets a new random bitrate target within the same chosen mode;
every completed video passes the existing bitrate and video-structure checks.
Original resolution is available for a single supported source. For a batch,
the chosen bitrate profile supplies the common resolution.

Preview buttons let you inspect individual files before or after rendering.
Settings, selection, and preview controls are locked while the queue runs.
Downloads for completed rows remain available while later files render.
Selecting more than 10 files reports the limit and keeps the current queue.
Selecting another valid group replaces the queue. Rendering again restarts all
selected files and replaces the old results. Download any results you want to
keep before replacing the queue, rendering it again, or closing the tab.

SAVING A BATCH
Download each completed video is available in all supported rendering browsers.
When the browser exposes a folder picker, Save all videos to a folder lets you
pick a destination once before rendering starts. Each verified video is written
and closed separately. Failed animations do not create output files. Incomplete
new files are removed after a write failure. Existing folder contents are kept;
duplicate output names receive a numeric suffix.

Folder picker support is detected on the device. When unavailable, that choice
is disabled and per-file downloads remain available. A single-file export keeps
the existing Choose a save location option where supported.
Cancelling the folder picker cancels the queue before encoding begins.
File system API reference:
https://developer.chrome.com/docs/capabilities/web-apis/file-system-access

Cancel queue stops the active file and all remaining files. Completed videos
stay available for download or remain saved in the chosen folder.
Click Render again to restart all selected files.

CANVAS AUTO-REPAIR
Auto-repair is enabled automatically for preview and video export.
Choose the animation .js file and click Render video as usual.
The animation worker normalizes recognizable Canvas argument formats while
preparing the existing frames. No additional rendering pass is needed.

Examples:
  ctx.lineTo([x, y])                 -> ctx.lineTo(x, y)
  ctx.lineTo({ x, y })               -> ctx.lineTo(x, y)
  ctx.quadraticCurveTo([p1, p2])     -> four numeric coordinates
  ctx.bezierCurveTo(p1, p2, end)     -> six numeric coordinates
  ctx.fillRect({ x, y, width, height }) -> four numeric coordinates
Points can be numeric arrays, typed arrays, or objects with finite x and y.
Coordinate arrays can be nested. Rectangle objects accept width/height or w/h.
All required coordinates must be present. Optional arc/ellipse direction
booleans are preserved.

Supported operations:
moveTo, lineTo, quadraticCurveTo, bezierCurveTo, arcTo, rect, fillRect,
strokeRect, clearRect, arc, ellipse, translate, scale, and transform.
Path2D path methods are covered too. Calls with the standard number of
arguments pass directly to the browser. Normalization and repair reports
run locally inside the animation worker.

The interface shows Canvas auto-repair applied, the affected methods, and
the number of repaired drawing calls. Preview and export have separate counts;
a repaired command can run once per frame. The loaded source file is used
through this runtime compatibility layer, without rewriting the file on disk.

LIMITS AND DIAGNOSTICS
This feature repairs recognizable argument packaging errors. It does not
reconstruct coordinates or logic that are missing from the source.
For example, lineTo(100) has no second coordinate and remains an error.
JavaScript syntax errors, undefined variables, and missing assets also require
source corrections. The feature uses deterministic normalization rather than
an AI service.

Errors during frame preparation show the frame number and animation time.
The filename is included, with line and column when available in the browser
stack trace. Example:
  Frame 394 / 420 · missing-coordinate.js:6:27 at 6.550 s · lineTo() requires 2 coordinate values...
An unrecoverable error stops that file's export and a batch continues to the next
file. Partial or unverified videos are not
provided for download or written to the selected save location.

Canvas API reference:
https://html.spec.whatwg.org/multipage/canvas.html

AUTO RANDOM BITRATE MODES
Mode            Export dimensions       Allowed video bitrate
4K (2160p)      3840 x 2160              70–100 Mbps
2K (1440p)      2560 x 1440              53–68 Mbps
FHD (1080p)     1920 x 1080              40–51 Mbps
HD (720p)       1280 x 720               20–38 Mbps

Every bitrate option uses Auto Random. Manual mode has been removed.
FHD is the default, matching the default 1080p resolution.
Selecting a bitrate mode also selects its resolution. Selecting a resolution
also selects the corresponding bitrate mode. Original resolution is available
when the source dimensions match one of the four supported profiles.

Every file in a render queue selects a new target within the chosen profile,
in 1 kbps steps. Whole-Mbps targets and their immediate surroundings are avoided.
Randomize lets you preview another target; Render video always chooses a fresh
target again for each file. Frame rate, duration, and MP4/MOV remain separate settings.

VERIFIED OUTPUT
Auto Random uses FFmpeg on the device opening the website. The WebCodecs option
is disabled because it cannot guarantee the required output bitrate range.
After encoding, the app measures the average video-stream bitrate from the
actual encoded video packets. It also checks codec, dimensions, frame rate,
frame count, and duration before providing a download or writing video data.

The actual video bitrate must fall inside the selected profile, remain within
5% of the encoder target, and avoid a whole-Mbps value at rounded/truncated
kbps precision. Codec headers can make it differ slightly from the random target.
The completion message shows the measured bitrate and verified range.

If the measured bitrate fails these checks, the app chooses another target
inside the middle half of the same profile and retries encoding. Prepared
animation frames are reused. The target shown in the interface updates when
the encoder retries. There are at most three encoding attempts.
If verification still fails, the app marks that file Failed and does not offer
the incorrect video or write its data to the selected save location. A batch
then continues automatically. A single-file export also reports Export failed.

These ranges apply to the average video-stream bitrate, as shown by a video
inspector. Container overhead can make the overall file bitrate differ slightly.

QUICK TEST
Choose your animation .js file, then use:
- Bitrate mode: Auto Random · HD (720p) · 20–38 Mbps
- Format: MP4 or MOV
- Frame rate: 30 FPS
- Duration: Quick test · 2 seconds
- Save video: Download when complete
Click Render video, wait for Video complete, then click Download video.
For a 4K export, choose Auto Random · 4K (2160p) · 70–100 Mbps, your desired
frame rate, and Full animation.

ENCODING AND MEMORY
Each animation frame is drawn directly to Canvas and captured as a lossless PNG.
FFmpeg.wasm encodes those frames with libx264 on this device's CPU.
The core is single-threaded. FFmpeg assets are bundled locally by Vite.
H.264 filler maintains the target bitrate when needed; it increases file size
without adding visual detail. MP4 and MOV contain H.264 video without audio
or transparency. MOV uses a QuickTime container.

Frames and video are temporarily stored in memory, including when choosing
a save location. Estimated output is limited to approximately 500 MB, exports
to 30,000 frames, and PNG files plus estimated output to approximately 600 MB.
Reduce the duration or resolution if memory is insufficient. Keep the tab open
while rendering. Cancel render stops a single export; Cancel queue stops the
active and remaining files. The memory limits apply separately to each export.

INTERFACE AND FONTS
The dark carbon/grid theme, cyan-blue-purple accents, Orbitron headings,
Rajdhani text, and responsive layout remain in place. The theme does not change
the animation's own colors or drawing code. Fonts load from the local bundle.
Visual reference: https://templatemo.com/live/templatemo_600_prism_flux
Font licenses: src/fonts/Orbitron-OFL.txt and src/fonts/Rajdhani-OFL.txt.
Font sources:
https://github.com/google/fonts/tree/main/ofl/orbitron
https://github.com/google/fonts/tree/main/ofl/rajdhani

ANIMATION API
The .js file must export an animation through a default export, module.exports,
or globalThis.SmartHomeAnimations[id]. It must provide:
  meta: { width, height, fps, duration, id?, title?, targetVideoBitrate? }
  drawFrame(canvas, seconds)
or:
  render(ctx, seconds, width, height)
The selected Auto Random profile controls export bitrate and dimensions.
The source targetVideoBitrate does not override it.
The animation must support OffscreenCanvas and avoid unavailable DOM APIs
or external assets.

For other devices, serve the website over HTTPS. The browser must support
Worker, OffscreenCanvas, and WebAssembly. The mobile layout was checked at
390 px width; physical Android devices were not tested in this update.

EXISTING DEPENDENCIES
- mediabunny 1.61.1
- @ffmpeg/ffmpeg 0.12.15
- @ffmpeg/util 0.12.2
- @ffmpeg/core 0.12.10
If a dependency is missing:
  npm install mediabunny@1.61.1 @ffmpeg/ffmpeg@0.12.15 @ffmpeg/util@0.12.2 @ffmpeg/core@0.12.10

VALIDATION
The production build passed. Four production browser exports using the supplied
Smoke and Heat Alert Monitoring animation were independently inspected with
ffprobe, including decoding and counting all frames:

Profile   Format   Duration   FPS   Frames   Measured video bitrate
HD        MP4      2 seconds  30    60       20,372.428 kbps
FHD       MOV      2 seconds  30    60       46,493.452 kbps
2K        MP4      2 seconds  30    60       57,631.436 kbps
4K        MOV      2 seconds  60    120      80,668.916 kbps

Every output matched its dimensions, duration, frame rate, and bitrate range.
Mode-to-resolution and resolution-to-mode synchronization passed, including
Original resolution for a supported source. Desktop and mobile layouts were
visually reviewed; no horizontal mobile overflow or browser errors were found.

A one-frame HD test near the upper boundary triggered automatic adjustment
and then passed with a measured bitrate of 33,837.600 kbps. A one-frame,
high-complexity HD test failed all three attempts: the download stayed hidden
and the save-location test confirmed zero video writes and an aborted save.

These checks validate behavior, not performance on your laptop or phone.

BATCH VALIDATION
Production-browser tests selected files through the multiple-file input:
- An invalid first source, a valid source, a late missing-coordinate error,
  and another valid source finished as Failed / Completed / Failed / Completed.
  The late error reported frame 4 / 10, its filename, and time 0.120 seconds.
  The earlier completed download remained usable after the later failure.
- The two successful FHD exports shared 25 FPS while keeping their own
  0.4-second and 0.6-second durations. Native ffprobe decoded all frames and
  measured 46,686.320 kbps and 40,471.360 kbps, both within 40–51 Mbps.
- Ten separate short HD videos, each 0.1 second at 30 FPS, completed in one
  queue with ten distinct targets. All ten downloads were independently
  decoded with ffprobe; their measured video bitrates were within 20–38 Mbps.
- Selecting 11 files was rejected while keeping the existing four-file queue
  and its download links. Long filenames wrapped on a 390 px mobile layout.
- A mocked browser folder picker opened once. Three verified MOV outputs
  were written and closed, an existing file was untouched, colliding names
  received suffixes, a broken source created no file, and a simulated write
  failure removed its new incomplete file before the next export succeeded.
  The three saved byte streams were independently inspected with ffprobe.
- Cancel queue kept the first completed download and marked the active and
  remaining files Cancelled. Cancelling the folder picker stopped the queue
  before export. Browsers without a folder picker retained per-file downloads.
The green and red check colors, responsive queue layout, and browser error
logs were checked. No horizontal mobile overflow or browser errors were found.
Physical Android hardware and native folder picker dialogs were not tested.

AUTO-REPAIR VALIDATION
The original browser error was reproduced with a one-argument lineTo call.
Fourteen supported operations, including Path2D, were compared against native
calls with explicit coordinates. The pixels matched exactly. Unsupported
missing/nonfinite coordinates and cyclic arrays were rejected.
The original Smoke and Heat Alert Monitoring source drew all 1,200 frames
without requiring repairs, and six sampled images matched the native reference.

Production exports with real Canvas argument errors:
- auto-repair-late-fhd.mp4: 1920 x 1080, 60 FPS, 7 seconds, 420 decoded frames, 44,621.787 kbps.
- auto-repair-objects.mov: 1280 x 720, 30 FPS, 2 seconds, 60 decoded frames, 28,213.452 kbps.
The late point-array error was triggered at 6.550 seconds. All 27 affected
calls were repaired and the 420-frame FHD export completed. The point-object,
rectangle, and curve test repaired 300 calls and completed a MOV export.

A genuinely missing coordinate stopped at frame 394 with the correct filename,
line, column, and time. The download stayed hidden, and the save-location test
confirmed zero writes and an aborted save. Cancellation and subsequent file
reload passed. Desktop and 390 px mobile layouts were visually checked, with
no horizontal overflow or browser errors. The production build passed.
