// SCULPT worker: runs one job (lib/sculpt.js runJob) off the main thread and hands the
// typed arrays back as transferables (zero copy). See sculpt.js for the job format.
import { runJob, transferables } from './sculpt.js';

self.onmessage = e => {
  const { id, job } = e.data;
  try {
    const res = runJob(job);
    self.postMessage({ id, res }, transferables(res));
  } catch (err) {
    self.postMessage({ id, err: String(err && err.stack || err) });
  }
};
