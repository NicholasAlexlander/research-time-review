import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
for (const dir of ['dist/client', 'dist/server', 'dist/.openai']) await mkdir(dir, { recursive: true });
for (const name of ['index.html', 'style.css', 'app.mjs', 'calc.mjs', 'calendar.mjs', 'weekly-export.mjs', 'events.mjs', 'events-ui.mjs', 'plan.mjs', 'event-cleanup.mjs']) await cp(name, `dist/client/${name}`);
await writeFile('dist/server/index.js', await readFile('worker/index.mjs'));
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
