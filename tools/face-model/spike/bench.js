// Phase 0 perf smoke test: run the face-detector .tflite and an
// embedder-size-class proxy .tflite on every available LiteRT.js backend,
// timing per-inference latency. Results land in the table, the <pre> JSON
// block, and window.__benchResults (for automation).
import { loadLiteRt, loadAndCompile, Tensor } from '/litert/index.js';

const MODELS = [
  {
    name: 'blaze_face_short_range (detector, 224 KB)',
    url: '/models/blaze_face_short_range.tflite',
  },
  { name: 'mobilenet_v3_small (embedder proxy, 4.1 MB)', url: '/models/mobilenet_v3_small.tflite' },
  // The real converted embedders — present once Phase 1's convert.py has run.
  {
    name: 'face_embedder_v1_fp32 (SFace, 38.5 MB)',
    url: '/models/face_embedder_v1_fp32.tflite',
    optional: true,
  },
  {
    name: 'face_embedder_v1_int8 (SFace dynamic-range, 9.9 MB)',
    url: '/models/face_embedder_v1_int8.tflite',
    optional: true,
  },
];
const WARMUP = 5;
const RUNS = 50;

const $ = (id) => document.getElementById(id);
const status = (msg) => {
  $('status').textContent = msg;
};

function quantile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)));
  return sorted[i];
}

function makeInput(details) {
  // Build a random input tensor matching the model's declared shape/dtype.
  const dims = Array.from(details.shape, (d) => (d > 0 ? d : 1));
  const size = dims.reduce((a, b) => a * b, 1);
  if (details.dtype !== 'float32') {
    throw new Error(`unhandled input dtype ${details.dtype}`);
  }
  const data = new Float32Array(size);
  for (let i = 0; i < size; i++) data[i] = Math.random();
  return new Tensor(data, dims);
}

async function benchOne(modelDef, accelerator) {
  const t0 = performance.now();
  const model = await loadAndCompile(modelDef.url, { accelerator });
  const compileMs = performance.now() - t0;
  try {
    const inputDetails = model.getInputDetails();
    const times = [];
    for (let i = 0; i < WARMUP + RUNS; i++) {
      const inputs = inputDetails.map(makeInput);
      const t1 = performance.now();
      const outputs = await model.run(inputs);
      // Read one output back to CPU inside the timed region: without this,
      // WebGPU timing measures command submission, not completion — the real
      // pipeline always reads the embedding/boxes back, so include the cost.
      const outs = Array.isArray(outputs) ? outputs : Object.values(outputs);
      const cpu = await outs[0].moveTo('wasm');
      cpu.toTypedArray();
      const dt = performance.now() - t1;
      cpu.delete();
      outs.slice(1).forEach((t) => t.delete());
      inputs.forEach((t) => t.delete());
      if (i >= WARMUP) times.push(dt);
    }
    times.sort((a, b) => a - b);
    return {
      model: modelDef.name,
      backend: accelerator,
      fullyAccelerated: model.isFullyAccelerated,
      compileMs: +compileMs.toFixed(1),
      meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2),
      p50Ms: +quantile(times, 0.5).toFixed(2),
      p95Ms: +quantile(times, 0.95).toFixed(2),
    };
  } finally {
    model.delete();
  }
}

async function main() {
  $('env').textContent =
    `UA: ${navigator.userAgent} — hardwareConcurrency: ${navigator.hardwareConcurrency}` +
    ` — WebGPU: ${'gpu' in navigator} — SharedArrayBuffer (threads): ${typeof SharedArrayBuffer !== 'undefined'}`;

  status('Initializing LiteRT.js WASM runtime…');
  // jspi: the converted SFace models hit an async execution path on the
  // WebGPU backend that throws "Asyncify is not defined" without it.
  const jspiOk = 'Suspending' in WebAssembly;
  await loadLiteRt('/litert-wasm/', { jspi: jspiOk });
  console.log(`loadLiteRt jspi=${jspiOk}`);

  const backends = ['wasm', ...('gpu' in navigator ? ['webgpu'] : [])];
  const results = [];
  const tbody = document.querySelector('#results tbody');
  $('results').hidden = false;

  for (const modelDef of MODELS) {
    if (modelDef.optional) {
      const head = await fetch(modelDef.url, { method: 'HEAD' });
      if (!head.ok) {
        console.log(`skipping ${modelDef.name} — ${modelDef.url} not present`);
        continue;
      }
    }
    for (const backend of backends) {
      status(`Benchmarking ${modelDef.name} on ${backend}…`);
      let row;
      try {
        row = await benchOne(modelDef, backend);
      } catch (e) {
        console.error(`${modelDef.name} on ${backend} failed`, e);
        row = { model: modelDef.name, backend, error: String(e) };
      }
      results.push(row);
      const tr = document.createElement('tr');
      tr.innerHTML = row.error
        ? `<td>${row.model}</td><td>${row.backend}</td><td colspan="5" class="fail">${row.error}</td>`
        : `<td>${row.model}</td><td>${row.backend}</td><td>${row.fullyAccelerated}</td>` +
          `<td>${row.compileMs}</td><td>${row.meanMs}</td><td>${row.p50Ms}</td><td>${row.p95Ms}</td>`;
      tbody.appendChild(tr);
    }
  }

  status(`Done — ${WARMUP} warmup + ${RUNS} timed runs per cell.`);
  $('json').textContent = JSON.stringify(results, null, 2);
  window.__benchResults = results;
}

main().catch((e) => {
  status(`FATAL: ${e}`);
  $('status').className = 'fail';
  window.__benchResults = { fatal: String(e) };
  console.error(e);
});
