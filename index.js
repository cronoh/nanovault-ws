require('dotenv').config(); // Load variables from .env into the environment

/** Configuration **/
const websocketPort = 3333; // Port that the websocket server will listen on (For incoming wallet connections)
const webserverPort = 9960; // Port that the webserver will listen on (For receiving new blocks from Nano node)
const statTime = 10; // Seconds between reporting statistics to console (Connected clients, TPS)

// Set up connection to PostgreSQL server used for storing timestamps (Will fail safely if not used)
const knex = require('knex')({
  client: 'pg',
  connection: {
    host : process.env.DB_HOST,
    port: process.env.DB_PORT,
    user : process.env.DB_USER,
    password : process.env.DB_PASS ? process.env.DB_PASS : '',
    database : process.env.DB_NAME
  }
});

/** End Configuration **/

const express = require('express');
const WebSocketServer = require('uws').Server;
const app = express();
const wss = new WebSocketServer({ port: websocketPort });

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
  tpsCount++;

  const fullBlock = req.body;
  try {
    fullBlock.block = JSON.parse(fullBlock.block);
    saveHashTimestamp(fullBlock.hash);
  } catch (err) {
    return console.log(`Error parsing block data! `, err.message);
  }

  let destinations = [];

  if (fullBlock.block.type === 'state') {
    if (fullBlock.is_send === 'true' && fullBlock.block.link_as_account) {
      destinations.push(fullBlock.block.link_as_account);
    }
    destinations.push(fullBlock.account);
  } else {
    destinations.push(fullBlock.block.destination);
  }

  // Send it to all!
  destinations.forEach(destination => {
    if (!subscriptionMap[destination]) return; // Nobody listening for this

    console.log(`Sending block to subscriber ${destination}: `, fullBlock.amount);

    subscriptionMap[destination].forEach(ws => {
      const event = {
        event: 'newTransaction',
        data: fullBlock
      };
      ws.send(JSON.stringify(event));
    });
  });
});

app.get('/health-check', (req, res) => {
  res.sendStatus(200);
});

app.listen(webserverPort, () => console.log(`Express server online`));

wss.on('connection', function(ws) {
  ws.subscriptions = [];
  console.log(`- New Connection`);
  ws.on('message', message => {
    try {
      const event = JSON.parse(message);
      parseEvent(ws, event);
    } catch (err) {
      console.log(`Bad message: `, err);
    }
  });
  ws.on('close', event => {
    console.log(`- Connection Closed`);
    ws.subscriptions.forEach(account => {
      if (!subscriptionMap[account] || !subscriptionMap[account].length) return; // Not in there for some reason?

      subscriptionMap[account] = subscriptionMap[account].filter(subWs => subWs !== ws);

      if (subscriptionMap[account].length === 0) {
        delete subscriptionMap[account];
      }
    });
  });
});

async function saveHashTimestamp(hash) {
  console.log(`Saving block timestamp: `, hash);
  const d = new Date();
  try {
    await knex('timestamps').insert({
      hash,
      timestamp: d.getTime() + (d.getTimezoneOffset() * 60 * 1000), // Get milliseconds in UTC
    });
  } catch (err) {
    console.log(`Error saving hash timestamp:`, err.message, err);
  }
}

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

function printStats() {
  const connectedClients = wss.clients.length;
  const tps = tpsCount / statTime;
  console.log(`[Stats] Connected clients: ${connectedClients}; TPS Average: ${tps}`);
  tpsCount = 0;
}

setInterval(printStats, statTime * 1000); // Print stats every x seconds

console.log(`Websocket server online!`);
