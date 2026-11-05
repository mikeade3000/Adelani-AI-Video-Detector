/* Pool of sandbox workers. A query that runs past the time limit has its worker terminated
 * (and replaced); each worker also has a memory cap. */
'use strict';
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

const SIZE = Math.max(1, Math.min(Number(process.env.SANDBOX_WORKERS) || Math.min(4, os.cpus().length), 16));
const WORKER_FILE = path.join(__dirname, 'sandbox-worker.js');

let seq = 0;
const idle = [];
const queue = [];
let total = 0;

function spawn() {
  const w = new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
  w.warm = false;
  w.on('error', () => {});
  total++;
  return w;
}

function release(w) {
  const next = queue.shift();
  if (next) dispatch(w, next); else idle.push(w);
}

function dispatch(w, task) {
  let done = false;
  const limit = (w.warm ? task.timeout : task.timeout + 5000);
  const finish = (res) => { if (done) return; done = true; clearTimeout(timer); w.off('message', onMsg); w.off('exit', onExit); task.resolve(res); };
  const onMsg = (msg) => { if (msg.id !== task.msg.id) return; w.warm = true; finish(msg); release(w); };
  const onExit = () => { total--; finish({ id: task.msg.id, error: 'The sandbox stopped unexpectedly (the query may use too much memory).' }); replace(); };
  const timer = setTimeout(() => {
    w.off('exit', onExit);
    w.terminate().catch(() => {});
    total--;
    finish({ id: task.msg.id, error: 'Time limit exceeded (' + task.timeout / 1000 + 's). Your query ran too long and was stopped.', timeout: true });
    replace();
  }, limit);
  w.on('message', onMsg);
  w.on('exit', onExit);
  w.postMessage(task.msg);
}

function replace() { const w = spawn(); release(w); }

function run(setup, sql, opts) {
  opts = opts || {};
  const msg = { id: ++seq, setup, sql: String(sql), check: opts.check || null, maxRows: opts.maxRows || 500 };
  return new Promise((resolve) => {
    const task = { msg, resolve, timeout: opts.timeout || 2000 };
    const w = idle.pop();
    if (w) dispatch(w, task);
    else if (total < SIZE) dispatch(spawn(), task);
    else queue.push(task);
  });
}

function warmUp() { for (let i = idle.length; i < SIZE; i++) idle.push(spawn()); }
function shutdown() { return Promise.all(idle.splice(0).map((w) => w.terminate())); }

module.exports = { run, warmUp, shutdown, SIZE };
