// Gera www/ para o app nativo: Tailwind compilado e jsPDF embutidos, funcionando 100% offline.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = 'www';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/vendor`, { recursive: true });

let html = readFileSync('index.html', 'utf8');
const style = html.match(/<style type="text\/tailwindcss">([\s\S]*?)<\/style>/);
if (!style) throw new Error('bloco <style type="text/tailwindcss"> não encontrado');
writeFileSync(`${out}/vendor/in.css`, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n${style[1]}`);
execFileSync('npx', ['tailwindcss', '-c', 'tailwind.config.cjs', '-i', `${out}/vendor/in.css`, '-o', `${out}/vendor/tailwind.css`, '--minify'], { stdio: 'inherit' });
rmSync(`${out}/vendor/in.css`);

cpSync('node_modules/jspdf/dist/jspdf.umd.min.js', `${out}/vendor/jspdf.umd.min.js`);
cpSync('node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.min.js', `${out}/vendor/jspdf.plugin.autotable.min.js`);

const replace = (from, to) => { const ok = from instanceof RegExp ? from.test(html) : html.includes(from); if (!ok) throw new Error('não encontrado: ' + from); html = html.replace(from, to); };
replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>\s*<script>[\s\S]*?<\/script>/, '<link rel="stylesheet" href="vendor/tailwind.css">');
replace(style[0], '');
replace('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js');
replace('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'vendor/jspdf.plugin.autotable.min.js');
if (/cdn\.tailwindcss|cdnjs/.test(html)) throw new Error('ainda há referências a CDN');
writeFileSync(`${out}/index.html`, html);

cpSync('icons', `${out}/icons`, { recursive: true });
cpSync('js', `${out}/js`, { recursive: true });

// Variáveis de ambiente do build (CI) sobrescrevem a configuração do Supabase.
const cfgPath = `${out}/js/config.js`;
let cfg = readFileSync(cfgPath, 'utf8');
for (const [env, key] of [['VA_SUPABASE_URL', 'SUPABASE_URL'], ['VA_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'], ['VA_CHECKOUT_SITE_URL', 'CHECKOUT_SITE_URL']]) {
  const v = process.env[env];
  if (v) cfg = cfg.replace(new RegExp(`${key}: '[^']*'`), `${key}: ${JSON.stringify(v)}`);
}
writeFileSync(cfgPath, cfg);
cpSync('manifest.webmanifest', `${out}/manifest.webmanifest`);
console.log('www/ gerado');
