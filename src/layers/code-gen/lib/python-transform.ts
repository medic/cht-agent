import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

/**
 * Per-process python3 availability check.
 * Returns true if `python3 --version` exits successfully, false otherwise.
 * Callers should cache the result to avoid spawning the check repeatedly.
 */
export async function checkPythonAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile('python3', ['--version'], { timeout: 3000 }, (error) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          console.error('[Code Gen Lib] python3 not found on PATH — large JSON modifications will be skipped.');
          console.error('[Code Gen Lib] Install python3 to enable JSON transform mode.');
        } else {
          console.error(`[Code Gen Lib] python3 check failed: ${error.message}`);
        }
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

export interface PythonTransformResult {
  /** Modified JSON content on success; null on any failure. */
  content: string | null;
  /** True if python3 was missing (ENOENT). Lets callers skip retry loops. */
  pythonMissing: boolean;
}

/**
 * Execute a Python script to transform a JSON file.
 * Writes the original content + script to temp files, runs python3, reads the result.
 */
export async function executePythonTransform(
  script: string,
  originalContent: string,
  filePath: string,
): Promise<PythonTransformResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cht-json-transform-'));
  const tmpJsonPath = path.join(tmpDir, path.basename(filePath));
  const tmpScriptPath = path.join(tmpDir, 'transform.py');

  try {
    fs.writeFileSync(tmpJsonPath, originalContent, 'utf-8');
    fs.writeFileSync(tmpScriptPath, script, 'utf-8');

    const result = await new Promise<PythonTransformResult>((resolve) => {
      execFile('python3', [tmpScriptPath, tmpJsonPath], { timeout: 30000 }, (error, _stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            console.error('[Code Gen Lib]   python3 binary disappeared mid-run.');
            if (stderr) console.error(`[Code Gen Lib]   stderr: ${stderr}`);
            resolve({ content: null, pythonMissing: true });
            return;
          }
          console.error(`[Code Gen Lib]   Python script error: ${error.message}`);
          if (stderr) console.error(`[Code Gen Lib]   stderr: ${stderr}`);
          resolve({ content: null, pythonMissing: false });
          return;
        }
        try {
          const modified = fs.readFileSync(tmpJsonPath, 'utf-8');
          JSON.parse(modified);
          resolve({ content: modified, pythonMissing: false });
        } catch (readErr) {
          console.error(`[Code Gen Lib]   Failed to read/validate modified JSON: ${readErr}`);
          resolve({ content: null, pythonMissing: false });
        }
      });
    });

    return result;
  } catch (error) {
    console.error(`[Code Gen Lib]   Python transform setup failed: ${error}`);
    return { content: null, pythonMissing: false };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}
