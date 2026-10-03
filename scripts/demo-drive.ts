import fs from 'node:fs';
import path from 'node:path';

/**
 * Prepares the local folder that simulates the Drive in demo mode (`npm run demo`).
 * Each step copies the case's fictitious files exactly as the package instructs:
 *
 *   npm run demo:drive reset          # empty folder + 01_CARGA_INICIAL, demo database erased
 *   npm run demo:drive add-minutes    # 02_ADICIONAR_DEPOIS_DA_CARGA (10-03 as a native Google Doc)
 *   npm run demo:drive add-conflict   # 03_CONFLITO (empty look-alike spreadsheet)
 *   npm run demo:drive edit-minutes   # edits the 10-04 minutes (new deadline)
 *
 * With the app running, changes are detected by the automatic sync (or "Sincronizar agora").
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures/drive');
const DEMO_DRIVE = path.join(ROOT, 'demo-drive');
const DEMO_DATA = path.join(ROOT, 'data/demo');

function copy(fromFolder: string, name: string, targetName = name): void {
  fs.copyFileSync(path.join(FIXTURES, fromFolder, name), path.join(DEMO_DRIVE, targetName));
  console.log(`  + ${targetName}`);
}

function touch(file: string): void {
  const now = new Date();
  fs.utimesSync(file, now, now);
}

const steps: Record<string, () => void> = {
  reset() {
    fs.rmSync(DEMO_DRIVE, { recursive: true, force: true });
    fs.rmSync(DEMO_DATA, { recursive: true, force: true });
    fs.mkdirSync(DEMO_DRIVE, { recursive: true });
    for (const name of fs.readdirSync(path.join(FIXTURES, '01_CARGA_INICIAL'))) copy('01_CARGA_INICIAL', name);
    console.log(`Pasta de demonstração recriada em ${DEMO_DRIVE} (banco de demonstração apagado).`);
  },
  'add-minutes'() {
    copy('02_ADICIONAR_DEPOIS_DA_CARGA', 'Ata_2026-10-03.md', 'Ata_2026-10-03.gdoc');
    copy('02_ADICIONAR_DEPOIS_DA_CARGA', 'Ata_2026-10-04.md');
    copy('02_ADICIONAR_DEPOIS_DA_CARGA', 'Ata_2026-10-03.docx');
    console.log('Atas adicionadas (a de 03/10 como Google Docs nativo simulado; o .docx original fica como "não processado").');
  },
  'add-conflict'() {
    copy('03_CONFLITO', 'Ata - copia vazia.xlsx');
    console.log('Planilha vazia homônima adicionada.');
  },
  'edit-minutes'() {
    const file = path.join(DEMO_DRIVE, 'Ata_2026-10-04.md');
    if (!fs.existsSync(file)) throw new Error('Rode "add-minutes" antes.');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('2026-10-10', '2026-10-12'));
    touch(file);
    console.log('Ata_2026-10-04.md editada: prazo da nova atividade de Carla passou para 2026-10-12.');
  },
};

const step = process.argv[2] ?? 'reset';
const run = steps[step];
if (!run) {
  console.error(`Passo desconhecido "${step}". Use: ${Object.keys(steps).join(', ')}`);
  process.exit(1);
}
fs.mkdirSync(DEMO_DRIVE, { recursive: true });
run();
