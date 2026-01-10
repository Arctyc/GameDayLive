import { Devvit } from "@devvit/public-api";
import { registerNHLModule } from "./sports/nhl/index.js";

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
});

// Register sport modules
registerNHLModule(Devvit);

// Future: registerNFLModule(Devvit);
// Future: registerNBAModule(Devvit);

export default Devvit;