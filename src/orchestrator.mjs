/** @typedef {{ job_id: string, status?: string, image_base64?: string, error?: string|string }} JobResponse */

function baseUrl(raw) {
  return String(raw || "").replace(/\/+$/, "");
}

export async function orchestratorHealthy(url, timeoutMs = 3000) {
  const ctl = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(`${baseUrl(url)}/health`, { signal: ctl });
    if (!res.ok) return false;
    const j = await res.json().catch(() => ({}));
    return j.ok === true;
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.orchestratorUrl
 * @param {string} opts.internalToken
 * @param {string} opts.userId
 * @param {Buffer} opts.imageBytes
 * @returns {Promise<string>} job id
 */
export async function submitPhotoJob(opts) {
  const url = `${baseUrl(opts.orchestratorUrl)}/internal/v1/jobs`;
  const form = new FormData();
  form.append("user_id", opts.userId);
  const blob = new Blob([opts.imageBytes], { type: "image/jpeg" });
  form.append("photo", blob, "photo.jpg");

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Internal-Token": opts.internalToken },
    body: form,
  });

  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    throw new QuotaExceededError(j.message || "quota");
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new OrchestratorHttpError(`create_job ${res.status}: ${txt.slice(0, 500)}`);
  }

  /** @type {{ job_id: string }} */
  const j = await res.json();
  return j.job_id;
}

/**
 * @param {object} opts
 * @param {string} opts.orchestratorUrl
 * @param {string} opts.internalToken
 * @param {string} opts.userId
 * @param {string} opts.jobId
 * @returns {Promise<JobResponse>}
 */
export async function getJob(opts) {
  const url = `${baseUrl(opts.orchestratorUrl)}/internal/v1/jobs/${encodeURIComponent(opts.jobId)}`;
  const res = await fetch(url, {
    headers: {
      "X-Internal-Token": opts.internalToken,
      "X-User-Id": opts.userId,
    },
  });
  if (res.status === 404) {
    throw new OrchestratorHttpError("job_not_found");
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new OrchestratorHttpError(`get_job ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

export class QuotaExceededError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export class OrchestratorHttpError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "OrchestratorHttpError";
  }
}

/**
 * @param {object} opts
 * @param {string} opts.orchestratorUrl
 * @param {string} opts.internalToken
 * @param {string} opts.userId
 * @param {string} opts.jobId
 * @param {{ intervalMs?: number, maxWaitMs?: number }} [cfg]
 * @returns {Promise<Buffer>}
 */
export async function waitForResultBuffer(opts, cfg = {}) {
  const intervalMs = cfg.intervalMs ?? 800;
  const maxWaitMs = cfg.maxWaitMs ?? 180_000;
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    const j = await getJob(opts);
    if (j.status === "done" && j.image_base64) {
      return Buffer.from(j.image_base64, "base64");
    }
    if (j.status === "failed") {
      throw new OrchestratorHttpError(typeof j.error === "string" ? j.error : "job_failed");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new OrchestratorHttpError("job_timeout");
}
