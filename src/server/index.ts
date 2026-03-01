import express from 'express';
import { createServer, getServerPort } from '@devvit/web/server';
import { menuAction, formStep1Action, formStep2Action } from './actions/configMenu';
import { registerSchedulers } from './leagues/nhl/scheduler';
import { jobMenuAction, jobCancelAction } from './actions/scheduleMenu';
import { registerTriggers } from './actions/triggers';

const app = express();
const router = express.Router();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

// Register bot functionality
menuAction(router);
formStep1Action(router);
formStep2Action(router);
jobMenuAction(router);
jobCancelAction(router);
registerSchedulers(router);
registerTriggers(router);

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);