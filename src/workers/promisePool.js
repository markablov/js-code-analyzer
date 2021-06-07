/*
 * Start to execute queued promise and when it would finish, reschedule another promise from queue
 */
const executeNextQueuedPromise = (queue, running, resolve, reject, fn, commonArgs) => {
  const { id, args = [] } = queue.shift();
  const promise = fn(id, ...args, ...commonArgs);
  const promiseWithRejectionHandler = promise.then(() => {
    delete running[id];
    if (queue.length) {
      // queue next job
      executeNextQueuedPromise(queue, running, resolve, reject, fn, commonArgs);
    } else if (Object.values(running).length === 0) {
      // all jobs are done
      resolve();
    }
  }).catch((err) => {
    // stop processing and wait until all other running threads would finish
    queue.length = 0;
    // it could be multiple rejects, it does not matter much which one would be first
    Promise.all(Object.values(running).filter((sibling) => sibling !== promise)).then(() => reject(err));
  });

  running[id] = promiseWithRejectionHandler;
};

/*
 * Execute functions in parallel with limited amount of running tasks at the same time
 *
 * iterator - iterable list of object { id, args }
 * fn - signature is (id, ...args, ..commonArgs)
 */
const runInParallel = (concurrency, iterator, fn, commonArgs = []) => new Promise((resolve, reject) => {
  const queue = [...iterator];
  const running = {};
  concurrency = Math.min(concurrency, queue.length);
  for (let i = 0; i < concurrency; i++) {
    executeNextQueuedPromise(queue, running, resolve, reject, fn, commonArgs);
  }
});

module.exports = {
  runInParallel,
};
