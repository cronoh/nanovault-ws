const express = require('express');
const WebSocketServer = require('uws').Server;

const wss = new WebSocketServer({ port: 3333 });
const app = express();

const subscriptionMap = {};

// Statistics reporting?
let tpsCount = 0;

app.use((req, res, next) => {
  if (req.headers['content-type']) return next();
  req.headers['content-type'] = 'application/json';
  next();
});
app.use(express.json());
app.post('/api/new-block', (req, res) => {
  res.sendStatus(200);
  console.log(`Received block`);
  tpsCount++;

  const fullBlock = req.body;
  fullBlock.block = JSON.parse(fullBlock.block);

  if (fullBlock.block.type !== 'send') return; // Only send for now?
  if (!subscriptionMap[fullBlock.block.destination]) return; // Nobody listening for this

  // Send it to all!
  console.log(`Got relevant block, sending to subscribers!`, fullBlock);
  subscriptionMap[fullBlock.block.destination].forEach(ws => {
    const event = {
      event: 'newTransaction',
      data: fullBlock
    };
    ws.send(JSON.stringify(event));
  });
});

app.get('/health-check', (req, res) => {
  res.sendStatus(200);
});

app.listen(9960, () => console.log(`Express server online`));

wss.on('connection', function(ws) {
  ws.subscriptions = [];
  console.log(`Got new connection! `, ws);
  ws.on('message', message => {
    try {
      const event = JSON.parse(message);
      console.log(`Got event`, event);
      parseEvent(ws, event);
    } catch (err) {
      console.log(`Bad message: `, err);
    }
  });
  ws.on('close', event => {
    console.log(`Connection closed, unsubscribing`);
    ws.subscriptions.forEach(account => {
      if (!subscriptionMap[account] || !subscriptionMap[account].length) return; // Not in there for some reason?

      subscriptionMap[account] = subscriptionMap[account].filter(subWs => subWs !== ws);

      if (subscriptionMap[account].length === 0) {
        delete subscriptionMap[account];
      }
    });
  });
});


function parseEvent(ws, event) {
  switch (event.event) {
    case 'subscribe':
      subscribeAccounts(ws, event.data);
      break;
    case 'unsubscribe':
      unsubscribeAccounts(ws, event.data);
      break;
  }
}

function subscribeAccounts(ws, accounts) {
  accounts.forEach(account => {
    if (ws.subscriptions.indexOf(account) !== -1) return; // Already subscribed
    ws.subscriptions.push(account);

    // Add into global map
    if (!subscriptionMap[account]) {
      subscriptionMap[account] = [];
    }

    subscriptionMap[account].push(ws);
  });
}
function unsubscribeAccounts(ws, accounts) {
  accounts.forEach(account => {
    const existingSub = ws.subscriptions.indexOf(account);
    if (existingSub === -1) return; // Not subscribed

    ws.subscriptions.splice(existingSub, 1);

    // Remove from global map
    if (!subscriptionMap[account]) return; // Nobody subscribed to this account?

    const globalIndex = subscriptionMap[account].indexOf(ws);
    if (globalIndex === -1) {
      console.log(`Subscribe, not found in the global map?  Potential leak? `, account);
      return;
    }

    subscriptionMap[account].splice(globalIndex, 1);
  });
}

const statTime = 10;
function printStats() {
  const connectedClients = wss.clients.length;
  const tps = tpsCount / statTime;
  console.log(`Connected clients: ${connectedClients}`);
  console.log(`TPS Average: ${tps}`);
  tpsCount = 0;
}

setInterval(printStats, statTime * 1000); // Print stats every 10 seconds


console.log(`Websocket server online!`);