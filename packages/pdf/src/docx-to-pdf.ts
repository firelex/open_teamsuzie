// DOCX → PDF via headless LibreOffice. Lifted from palisade-ai/brief-pdf.ts so
// it can be reused across @teamsuzie/document-conversion, palisade, and other
// consumers. Shells out to `soffice --headless --convert-to pdf` against a
// temp DOCX, reads the PDF bytes back, cleans up. Disposable user-profile per
// call so we never contend with a running LibreOffice UI instance or leave
// stale profile locks behind.

import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

// Same probe order as doc-auto's docx-to-pdf.ts.
const SOFFICE_CANDIDATES = [
  '/opt/homebrew/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/libreoffice',
  '/usr/bin/soffice',
];

let cachedBinary: string | null | undefined;

function resolveSoffice(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const p of SOFFICE_CANDIDATES) {
    try {
      fsSync.accessSync(p, fsSync.constants.X_OK);
      cachedBinary = p;
      return p;
    } catch {
      // keep looking
    }
  }
  cachedBinary = null;
  return null;
}

export function isLibreOfficeAvailable(): boolean {
  return resolveSoffice() != null;
}

/**
 * Convert an office document with headless LibreOffice. `inputExt` is the
 * source extension without the dot (docx, doc, pptx, ppt, xlsx, xls, odt,
 * rtf, ...); `target` is a LibreOffice convert-to format such as "pdf",
 * "docx", "xlsx" or "pptx". Throws with LibreOffice's message on failure
 * and an install hint when it is missing.
 */
export async function convertWithLibreOffice(
  bytes: Buffer,
  inputExt: string,
  target: string,
): Promise<Buffer> {
  const ext = inputExt.replace(/^\./, '').toLowerCase();
  const fmt = target.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]+$/.test(ext) || !/^[a-z0-9]+$/.test(fmt)) {
    throw new Error(`invalid conversion ${inputExt} -> ${target}`);
  }
  const soffice = resolveSoffice();
  if (!soffice) {
    throw new Error(
      'LibreOffice not found. Install via `brew install --cask libreoffice` and restart the backend.',
    );
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teamsuzie-office-'));
  const profileDir = path.join(workDir, 'profile');
  const inPath = path.join(workDir, `input.${ext}`);
  const outPath = path.join(workDir, `input.${fmt}`);
  try {
    await fs.writeFile(inPath, bytes);
    await runSoffice(soffice, profileDir, inPath, workDir, fmt);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/** DOCX to PDF (kept for existing callers). */
export async function convertDocxBufferToPdf(docxBytes: Buffer): Promise<Buffer> {
  return convertWithLibreOffice(docxBytes, 'docx', 'pdf');
}

function runSoffice(
  bin: string,
  profileDir: string,
  inputPath: string,
  outDir: string,
  format: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        `-env:UserInstallation=file://${profileDir}`,
        '--headless',
        '--convert-to',
        format,
        '--outdir',
        outDir,
        inputPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    // Two-minute hard cap — a hung soffice shouldn't pin the request
    // forever. Real conversions for an analyst brief land in <5s.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('LibreOffice conversion timed out after 120s.'));
    }, 120_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`LibreOffice exited with code ${code}: ${stderr.slice(0, 400)}`));
      }
    });
  });
}
