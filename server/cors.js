const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
const allowedHeaders = ['content-type', 'authorization'];

export function applyCors(request, response, { frontendOrigin } = {}) {
  response.setHeader('Vary', 'Origin');
  const origin = request.headers.origin;
  if (origin !== undefined) {
    if (!frontendOrigin || origin !== frontendOrigin) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { code: 'origin_rejected', message: 'Origin not allowed' } }));
      return true;
    }
    response.setHeader('Access-Control-Allow-Origin', frontendOrigin);
    response.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (request.method !== 'OPTIONS' || request.headers['access-control-request-method'] === undefined) return false;
  const requestedMethod = request.headers['access-control-request-method'].toUpperCase();
  const requestedHeaders = (request.headers['access-control-request-headers'] ?? '')
    .split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
  if (origin !== frontendOrigin || !allowedMethods.includes(requestedMethod)
    || requestedHeaders.some((header) => !allowedHeaders.includes(header))) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'preflight_rejected', message: 'Preflight request not allowed' } }));
    return true;
  }
  response.writeHead(204);
  response.end();
  return true;
}
