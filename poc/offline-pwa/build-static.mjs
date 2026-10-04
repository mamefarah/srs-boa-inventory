// Builds the static (GitHub Pages) version into poc/offline-pwa/dist: the same app plus static-mode.js,
// which makes the service worker answer /api/poc/* itself (state kept on the phone).
import { cpSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'public'), out, { recursive: true });
// Sign-in test bundle (needs the repo's installed dependencies: firebase and esbuild).
try {
  const { build } = await import('esbuild');
  await build({ entryPoints: [path.join(root, 'src/auth-entry.js')], bundle: true, minify: true, format: 'iife', target: 'es2020', outfile: path.join(out, 'auth.js'), logLevel: 'warning' });
  console.log('bundled sign-in test');
} catch (e) {
  console.warn('sign-in test not bundled (run npm ci first):', e.message.split('\n')[0]);
  rmSync(path.join(out, 'auth.html'), { force: true });
}
writeFileSync(path.join(out, 'static-mode.js'), 'self.POC_STATIC_MODE = true;\n');
writeFileSync(path.join(out, '.nojekyll'), '');
console.log('built', out);
