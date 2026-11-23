/** Vite's inline worker import: the module's default export makes the worker (its code is inlined in the page). */
declare module '*?worker&inline' {
  const WorkerConstructor: { new (options?: { name?: string }): Worker };
  export default WorkerConstructor;
}
