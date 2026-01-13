import express from 'express';
import { createServer, getServerPort } from '@devvit/web/server';

import { menuAction } from './actions/configMenu';
import { formAction } from './actions/submitForm';
import { registerSchedulers } from './actions/scheduler';

const app = express();
const router = express.Router();

// Register bot functionality
menuAction(router);
formAction(router);
registerSchedulers(router);

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);