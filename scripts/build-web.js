const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const out = path.join(root, 'www');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
fs.rmSync(path.join(out, 'supabase'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'supabase'), path.join(out, 'supabase'), { recursive: true });

const url = String(process.env.SUPABASE_URL || '').trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
if (url && publishableKey) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('SUPABASE_URL must be a valid https://<project>.supabase.co URL');
  }
  const htmlPath = path.join(out, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const moduleTag = '<script type="module" src="./supabase/cloud-portal.js"></script>';
  if (!html.includes(moduleTag)) throw new Error('Cloud portal module tag was not found in index.html');
  const config = JSON.stringify({ url, publishableKey }).replace(/</g, '\\u003c');
  html = html.replace(moduleTag, '<script>window.DCOS_SUPABASE_CONFIG=' + config + ';</script>\n' + moduleTag);
  fs.writeFileSync(htmlPath, html);
  console.log('Built-in public Supabase config injected into Android web assets.');
} else {
  console.log('No Supabase build config provided; cloud portal will ask for URL and publishable key on this device.');
}
