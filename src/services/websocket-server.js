const { WebSocketServer } = require('ws');
const url = require('url');

// Map of recipeId -> Set of active WebSocket connections
const sessions = new Map();

/**
 * Initialize the WebSocket server and bind it to the HTTP server instance.
 */
function initWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade header manually to routing/filter by query param
  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname, query } = url.parse(request.url, true);

    if (pathname === '/ws/cook') {
      const recipeId = query.recipeId;
      if (!recipeId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, recipeId);
      });
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request, recipeId) => {
    console.log(`[WS] Client connected to recipe session: ${recipeId}`);
    
    // Register socket to session
    if (!sessions.has(recipeId)) {
      sessions.set(recipeId, new Set());
    }
    sessions.get(recipeId).add(ws);

    // Broadcast helpers
    const broadcast = (dataStr) => {
      const clients = sessions.get(recipeId);
      if (!clients) return;
      
      for (const client of clients) {
        if (client !== ws && client.readyState === 1) { // WebSocket.OPEN
          try {
            client.send(dataStr);
          } catch (e) {
            console.error('[WS] Send failed:', e.message);
          }
        }
      }
    };

    ws.on('message', (message) => {
      try {
        const messageStr = message.toString();
        // Parse message validation checks
        const parsed = JSON.parse(messageStr);
        console.log(`[WS] Message received for recipe ${recipeId}:`, parsed.type);
        
        // Broadcast the event to all other screens connected to the same recipe
        broadcast(messageStr);
      } catch (err) {
        console.error('[WS] Message handling error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Client disconnected from recipe session: ${recipeId}`);
      const clients = sessions.get(recipeId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          sessions.delete(recipeId);
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Connection error on recipe ${recipeId}:`, err.message);
    });
  });

  console.log('[WS] WebSocket Server initialized and attached to HTTP Server.');
}

module.exports = { initWebSocketServer };
