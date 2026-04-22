// Main thread: fetches an STL, hands its ArrayBuffer to the worker
// (transferable, zero-copy), awaits the PNG, records timings.

const worker = new Worker("./render-worker.js", { type: "module" });
const pending = new Map();

worker.addEventListener("message", (e) => {
  const { jobId, pngBuffer, workerElapsed, error } = e.data;
  const entry = pending.get(jobId);
  if (!entry) return;
  pending.delete(jobId);
  if (error) entry.reject(new Error(error));
  else entry.resolve({ pngBuffer, workerElapsed });
});

worker.addEventListener("error", (e) => {
  console.error("Worker error:", e);
});

let jobCounter = 0;

async function runJob(stlUrl) {
  const mainStart = performance.now();
  const response = await fetch(stlUrl);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${stlUrl}: ${response.status}`);
  }
  const stlBuffer = await response.arrayBuffer();
  const jobId = ++jobCounter;
  const { pngBuffer, workerElapsed } = await new Promise(
    (resolve, reject) => {
      pending.set(jobId, { resolve, reject });
      worker.postMessage({ jobId, stlBuffer }, [stlBuffer]);
    },
  );
  return {
    workerElapsed,
    totalElapsed: performance.now() - mainStart,
    pngBuffer,
  };
}

function addRow(text) {
  const row = document.createElement("div");
  row.className = "row";
  row.textContent = text;
  document.getElementById("results").appendChild(row);
  return row;
}

async function runAndReport(label, stlUrl, targetMs, iterations = 3) {
  const row = addRow(`${label}: warming up…`);
  try {
    // Warm up the worker + GL context + three modules.
    await runJob(stlUrl);
  } catch (err) {
    row.textContent = `${label}: ERROR during warm-up — ${err.message}`;
    row.classList.add("fail");
    return null;
  }

  const times = [];
  let lastResult = null;
  for (let i = 0; i < iterations; i++) {
    row.textContent = `${label}: run ${i + 1}/${iterations}…`;
    lastResult = await runJob(stlUrl);
    times.push(lastResult.workerElapsed);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const pngKb = (lastResult.pngBuffer.byteLength / 1024).toFixed(1);
  const pass = median < targetMs;
  row.textContent = `${label}: worker min=${min.toFixed(0)}ms median=${median.toFixed(0)}ms max=${max.toFixed(0)}ms — target <${targetMs}ms — PNG ${pngKb}KB`;
  row.classList.add(pass ? "pass" : "fail");

  // Render the last PNG so the user can eyeball correctness.
  const blob = new Blob([lastResult.pngBuffer], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = url;
  img.alt = label;
  const cap = document.createElement("figcaption");
  cap.textContent = `${label} — ${pngKb}KB`;
  fig.appendChild(img);
  fig.appendChild(cap);
  document.getElementById("thumbs").appendChild(fig);

  return { min, median, max, pass };
}

function setButtonsDisabled(disabled) {
  for (const b of document.querySelectorAll("button")) b.disabled = disabled;
}

async function wrap(fn) {
  setButtonsDisabled(true);
  try {
    await fn();
  } finally {
    setButtonsDisabled(false);
  }
}

document.getElementById("run-100k").onclick = () =>
  wrap(() => runAndReport("100k tri", "./fixture-100k.stl", 300));
document.getElementById("run-1m").onclick = () =>
  wrap(() => runAndReport("1M tri", "./fixture-1m.stl", 2000));
document.getElementById("run-both").onclick = () =>
  wrap(async () => {
    await runAndReport("100k tri", "./fixture-100k.stl", 300);
    await runAndReport("1M tri", "./fixture-1m.stl", 2000);
  });
document.getElementById("clear").onclick = () => {
  document.getElementById("results").innerHTML = "";
  document.getElementById("thumbs").innerHTML = "";
};
