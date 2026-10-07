# Native cloud renderer

This optional engine runs on the standard Ubuntu CPU runner in GitHub Actions.
It uses Playwright Chromium to draw Canvas frames, streams lossless PNG buffers to
native FFmpeg/libx264, then verifies H.264, dimensions, frame rate, frame count,
duration, and the selected Auto Random bitrate range with ffprobe. It does not
use a dedicated GPU or FFmpeg.wasm.

For the existing XivArc/JS-Video-Render website, follow
`../SIMPLE_CLOUD_SETUP_ID.txt`. Commit this directory, the complete `src`
directory, and `../.github/workflows/render-cloud.yml` to `main`. Test the
workflow with its default input `cloud/jobs/example-job.json` first.

## Connect once, then drop and render

Create a fine-grained GitHub token restricted to this repository with Contents
and Actions set to Read and write. Connect it in the website. Remember is
optional and stores the token in this browser; otherwise it stays in the tab.
Drop 1–10 Canvas JS files, choose settings, and click Render. The website
uploads `cloud/jobs/<unique-id>.json` and dispatches this workflow on main.
It tracks the returned run ID, or resolves a lost response by the unique
run title without automatically dispatching twice. Reopen the website to
restore jobs and retrieve final results. No AI or separate backend is required.

The result publisher step receives GITHUB_TOKEN after rendering and commits
only the small report to `cloud/results/<job-id>.json` with run ID/attempt.
Checkout does not persist credentials, and the renderer step is not given the
publishing token. Workflow Contents write permission is required for reports.
Publishing errors do not hide completed Artifact downloads. The website only
marks files successful or failed when a matching report establishes the result.
Real workflow phases are polled; per-frame progress is still available in logs.

For diagnostics, Actions can still run the provided `cloud/jobs/example-job.json`
manually. The website flow handles ordinary jobs without manual JSON uploads.

The job format has `version: 1`, an identifier, `settings` (format, FPS, duration
choice, and bitrate mode), and `files` (filename, full JavaScript source, and
random target bitrate). It supports the same Canvas animation API as the
browser: `meta` plus `drawFrame(canvas, seconds)` or
`render(ctx, seconds, width, height)`, using a default export, CommonJS, or
`globalThis.SmartHomeAnimations[id]`.
It also accepts a directly exported `draw(ctx, seconds, width, height)` function
with `draw.meta` through the same export mechanisms. The function adapter does
not rewrite source or timing; required metadata and limits are still checked.
The chosen Auto Random profile controls dimensions and verified bitrate,
including for sources that attach their own `draw.exportSettings`.

Jobs accept 1–10 sources, each up to 5 MB in UTF-8, and a total JSON size of
20 MB. Sources must be trusted, self-contained Canvas JavaScript. Imports,
dynamic code execution, external assets, and network access are unsupported.
The worker blocks common networking APIs and the local server supplies a
restrictive CSP. This is not a complete security sandbox for hostile code.
User source is evaluated only in a Chromium worker, never directly in Node.

## Rendering and results

Files run sequentially with a fresh worker per source and a 30-second watchdog
for loading/drawing. A late JavaScript error stops that source and removes its
partial video; the next source still runs. Recognizable Canvas argument forms
are normalized by the existing repair helper. AI repair is not part of this
workflow.

Binary PNG frame transfers use backpressure and keep one frame in flight. Frames
are not stored as PNG files. Compressing each frame avoids transferring 33 MB
of raw RGBA for every 4K frame. FFmpeg uses up to four CPU threads, the `veryfast`
x264 preset, and H.264 filler to maintain the requested bitrate. Filler increases
file size without adding detail. Outputs are MP4/MOV without audio/transparency.
Verification allows three bitrate attempts; retries redraw the animation.

The engine estimates a 2 GB/video and 8 GB/job output budget, checks available
disk space with a 500 MB reserve, and accepts up to 30,000 frames per video.
The workflow timeout is 180 minutes including setup. Fixed durations of 10–60
seconds fit the full animation; quick tests clip the start at original speed.
Animations should use their provided time parameter, not a wall clock.

The engine writes videos, `report.json`, and `summary.md` into `cloud-output/`.
The workflow uploads those as Artifacts even when some sources fail, retaining
them for **3 days**. A run fails overall if any source fails. Download completed
videos before retention expires; nothing is automatically written to a laptop
while it is off. Recent cloud jobs shows workflow phases and final file results.
The current tab's selected queue also receives those final results.

The Actions summary shows a green/red result for each file and measured bitrate.
`pipelineFPS` measures frames divided by time spent drawing, streaming, and
encoding for the successful attempt; setup, retries, and verification are
outside this metric. `elapsedSeconds` for each file includes those attempts and
verification. `canvasFPS` measures worker drawing/readback RPC time only.
Neither metric is the output video's chosen playback FPS. Real performance
must be measured on the user's runner and representative animation.

Run one batch at a time. Workflow concurrency serializes rendering; GitHub
supports a single pending run in a concurrency group, so submitting many
workflows at once can replace older pending runs.

## Source visibility and retention

Uploaded job JSON and small result reports are committed and remain in Git history. Public
repository jobs are public. Deleting a JSON file later does not erase its history.
Videos are stored as temporary Artifacts, not committed to the repository.
Short retention does not guarantee usage stays within an account's allowance.

## Local diagnostics

For local native testing, install Node.js 24 and FFmpeg/ffprobe, then run:

```sh
cd cloud
npm ci
npx playwright install --with-deps chromium
CLOUD_JOB_FILE=cloud/jobs/example-job.json npm run render
```

The job path is always relative to the project root, even with `cloud` as the
working directory. It must point directly inside `cloud/jobs/`. The optional
`CLOUD_CHROMIUM_EXECUTABLE` environment variable selects a local diagnostic
browser binary; the GitHub workflow uses Playwright's installed Chromium.
Output names are sanitized and existing files receive a numeric suffix.
Use a clean `cloud-output` directory when comparing local diagnostic runs.

Official references:

- https://playwright.dev/docs/ci
- https://ffmpeg.org/ffmpeg-formats.html#image2_002c-image2pipe
- https://github.com/actions/upload-artifact
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
