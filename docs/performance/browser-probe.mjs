// Run after pnpm build and pnpm exec next start -p 3107.
// Software WebGL verifies redraw behavior, not real GPU frame rate.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.route('**/api/transport/search?**', route => route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.probe = { clear2d: {}, drawGL: 0, frames: 0, hitTests: 0, hitTestsTotal: 0, longTasks: [] };
    const hit = Document.prototype.elementFromPoint;
    Document.prototype.elementFromPoint = function (...args) { window.probe.hitTests++; window.probe.hitTestsTotal++; return hit.apply(this, args); };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      const key = this.canvas.isConnected ? `connected-${this.canvas.width}x${this.canvas.height}` : `offscreen-${this.canvas.width}x${this.canvas.height}`;
      window.probe.clear2d[key] = (window.probe.clear2d[key] || 0) + 1;
      return clear.apply(this, args);
    };
    for (const method of ['drawArrays', 'drawElements']) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (...args) { window.probe.drawGL++; return original.apply(this, args); };
    }
    const frame = () => { window.probe.frames++; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    try { new PerformanceObserver(list => window.probe.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true }); } catch {}
  });
  const base = process.env.PROBE_URL || 'http://localhost:3107';
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Probe requires localhost');
  await page.goto(base);
  await page.waitForTimeout(2200);
  const initialResources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({ path: new URL(e.name).pathname, type: e.initiatorType, decodedBytes: e.decodedBodySize, encodedBytes: e.encodedBodySize, transferBytes: e.transferSize })));
  const sample = async label => {
    await page.evaluate(() => { window.probe.clear2d = {}; window.probe.drawGL = 0; window.probe.frames = 0; window.probe.hitTests = 0; });
    const start = Date.now();
    await page.waitForTimeout(2200);
    return { label, elapsedMs: Date.now() - start, ...(await page.evaluate(() => ({ ...window.probe, longTasks: undefined }))) };
  };
  const samples = [await sample('idle before route')];
  await page.mouse.click(650, 450);
  await page.waitForTimeout(400);
  await page.mouse.move(830, 390, { steps: 10 });
  await page.waitForTimeout(350);
  await page.mouse.click(830, 390);
  await page.waitForTimeout(150);
  await page.mouse.click(830, 390);
  await page.mouse.move(0, 899);
  await page.waitForTimeout(2500);
  const landedText = await page.locator('body').innerText();
  samples.push(await sample('after route landing'));
  // Unrelated chat-like DOM updates must not rescan the whole page for camera framing.
  await page.evaluate(() => {
    let n = 0;
    const marker = document.createElement('span'); marker.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none'; document.body.append(marker);
    const timer = setInterval(() => { marker.textContent = String(++n); if (n >= 6) { clearInterval(timer); marker.remove(); } }, 300);
  });
  samples.push(await sample('unrelated DOM updates after landing'));
  // Software GPUs can need longer to finish delta-time-capped camera transitions.
  await page.waitForTimeout(10000);
  samples.push(await sample('normal motion after extended settling'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(500);
  samples.push(await sample('landed with reduced motion'));
  // Auth is URL driven. Open it without submitting a save or needing a live fare.
  await page.evaluate(() => window.history.pushState(null, '', '/?auth=signup'));
  await page.getByRole('dialog').waitFor();
  const beforeEscape = { dialog: await page.getByRole('dialog').count(), ticket: await page.locator('section.ts').count() };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const afterEscape = { dialog: await page.getByRole('dialog').count(), ticket: await page.locator('section.ts').count(), body: await page.locator('body').innerText() };
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({ path: new URL(e.name).pathname, type: e.initiatorType, decodedBytes: e.decodedBodySize, encodedBytes: e.encodedBodySize, transferBytes: e.transferSize })));
  const totals = predicate => resources.filter(predicate).reduce((s, r) => ({ count: s.count + 1, decodedBytes: s.decodedBytes + r.decodedBytes, encodedBytes: s.encodedBytes + r.encodedBytes }), { count: 0, decodedBytes: 0, encodedBytes: 0 });
  const report = { label: process.env.PROBE_LABEL || 'audit', commit: process.env.PROBE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceState: process.env.PROBE_SOURCE_STATE || 'uncommitted implementation on the recorded parent commit', browser: await browser.version(), environment: 'Local production Next server; no credentials; Chromium headless SwiftShader, 1440x900 DPR1; transport API aborted. Instrumented counts, not a hardware performance benchmark.', samples, landedText, beforeEscape, afterEscape, timings: await page.evaluate(() => performance.getEntriesByType("measure").filter(e => e.name.startsWith("portal:")).map(e => ({ name: e.name, durationMs: e.duration }))), errors, totals: { js: totals(r => r.path.startsWith('/_next/static/') && r.path.endsWith('.js')), css: totals(r => r.path.endsWith('.css')), fonts: totals(r => r.path.endsWith('.woff2')), textures: totals(r => r.path.startsWith('/textures/')) }, initialResources, resources };
  fs.writeFileSync(process.env.PROBE_OUTPUT || 'docs/performance/browser-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ samples, landedText, beforeEscape, afterEscape, timings: await page.evaluate(() => performance.getEntriesByType("measure").filter(e => e.name.startsWith("portal:")).map(e => ({ name: e.name, durationMs: e.duration }))), errors, totals: report.totals }, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
