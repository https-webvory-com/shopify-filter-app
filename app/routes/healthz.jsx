// Deliberately independent of authentication, database and search availability:
// the supervisor uses this to detect an HTTP process whose event loop is stuck.
export const loader = () => new Response('ok', {
  headers: {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'},
});
