import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_SCRIPT = path.join(__dirname, "crunchbase_damru.py");
const DAMRU_PYTHON = path.join(__dirname, "../../../../.venv-damru/bin/python");
const PYTHON_BIN = process.env.PYTHON_BIN || (existsSync(DAMRU_PYTHON) ? DAMRU_PYTHON : "python3");

function createHttpError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function runPythonCrawler(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PYTHON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;

      // Forward Python logs to Node.js console in real-time
      for (const line of text.split("\n").filter(Boolean)) {
        try {
          const log = JSON.parse(line);
          const level = log.level || "info";
          const msg = `[crunchbase-py] ${log.message}`;

          if (level === "error") {
            console.error(msg, log.details || "");
          } else if (level === "warn") {
            console.warn(msg, log.details || "");
          } else {
            console.info(msg, log.details || "");
          }
        } catch {
          console.info(`[crunchbase-py] ${line}`);
        }
      }
    });

    child.on("error", (error) => {
      reject(createHttpError(500, `Failed to spawn Python process: ${error.message}`, {
        python_bin: PYTHON_BIN,
        script: PYTHON_SCRIPT
      }));
    });

    child.on("close", (code) => {
      if (!stdout.trim()) {
        reject(createHttpError(500, "Python crawler returned no output.", {
          exit_code: code,
          stderr: stderr.slice(-2000)
        }));
        return;
      }

      try {
        const result = JSON.parse(stdout);

        if (result.ok === false) {
          reject(createHttpError(
            result.status_code || 500,
            result.error || "Python crawler failed.",
            result.details || null
          ));
          return;
        }

        resolve(result);
      } catch (parseError) {
        reject(createHttpError(500, `Failed to parse Python output: ${parseError.message}`, {
          exit_code: code,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000)
        }));
      }
    });

    // Send input JSON to Python via stdin
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export default async function crawlCrunchbaseSite(input) {
  return runPythonCrawler(input);
}
