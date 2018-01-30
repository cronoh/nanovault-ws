const express = require('express');
const WebSocketServer = require('uws').Server;

const wss = new WebSocketServer({ port: 3333 });
const app = express();

const subscriptionMap = {};

app.use((req, res, next) => {
  if (req.headers['content-type']) return next();
  req.headers['content-type'] = 'application/json';
  next();
});
app.use(express.json());
app.post('/api/new-block', (req, res) => {
  res.sendStatus(200);

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
    console.log('Got message', message);
    try {
      const event = JSON.parse(message);
      console.log(`Got event`, event);
      parseEvent(ws, event);
    } catch (err) {
      console.log(`Bad message: `, err);
    }
  });
  ws.on('close', event => {
    console.log(`Connection closed, unsubscribe?`);
    console.log(`global map: `, subscriptionMap);
    ws.subscriptions.forEach(account => {
      if (!subscriptionMap[account] || !subscriptionMap[account].length) return; // Not in there for some reason?

      subscriptionMap[account] = subscriptionMap[account].filter(subWs => subWs !== ws);

      if (subscriptionMap[account].length === 0) {
        delete subscriptionMap[account];
      }
    });

    console.log(`Finished cleaning up subscriptions`, ws.subscriptions);
    console.log(`global map: `, subscriptionMap);
  });
});


function parseEvent(ws, event) {
  console.log(`Parsing event `, ws, event);
  switch (event.event) {
    case 'subscribe':
      subscribeAccounts(ws, event.data);
      const accounts = event.data;
      break;
  }
}

function subscribeAccounts(ws, accounts) {
  console.log(`Subscribing!`);
  accounts.forEach(account => {
    if (ws.subscriptions.indexOf(account) !== -1) return; // Already subscribed
    ws.subscriptions.push(account);

    // Add into global map
    if (!subscriptionMap[account]) {
      subscriptionMap[account] = [];
    }

    console.log(`Added new subscription`);

    subscriptionMap[account].push(ws);
  });
}

console.log(`Websocket server online!`);