await import('../../erp-backend/src/test/setup.ts');
const { createApp } = await import('../../erp-backend/src/app.ts');
// This child process opens no database and runs no jobs. A parser crash is isolated here.
const server = createApp().listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ port: (server.address() as any).port }));
});
setTimeout(() => { server.closeAllConnections(); server.close(() => process.exit(0)); }, 10000);
