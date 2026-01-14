import express from 'express';
import { createServer, getServerPort } from '@devvit/web/server';

import { menuAction } from './actions/configMenu';
import { formAction } from './actions/submitForm';
// TODO: Import scheduleMenu
import { registerSchedulers } from './leagues/nhl/scheduler';
import { jobCancelAction, jobMenuAction } from './actions/scheduleMenu';

const app = express();
const router = express.Router();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

// Register bot functionality
menuAction(router);
formAction(router);
jobMenuAction(router);
jobCancelAction(router);
registerSchedulers(router);

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);