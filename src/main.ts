import { Devvit } from "@devvit/public-api";
import { registerNHLModule } from "./leagues/nhl/index.js";
import { getSubredditConfig, setSubredditConfig } from "./core/config.js";
import { NHL_TEAMS } from "./leagues/nhl/config.js";

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: {
    domains: ['api-web.nhle.com'],
  },
});

// Register league modules
registerNHLModule(Devvit);

const configForm = Devvit.createForm(
  {
    fields: [
      {
        name: "league",
        label: "League",
        type: "select",
        options: [
          { label: "NHL", value: "nhl" },
        ],
        defaultValue: ["nhl"],
        required: true,
      },
      {
        name: "team",
        label: "Your Team",
        type: "select",
        options: NHL_TEAMS,
        required: true,
      },
      {
        name: "postGameThreads",
        label: "Create post-game threads",
        type: "boolean",
        defaultValue: true,
      },
    ],
    title: "Configure GameDayLive",
    acceptLabel: "Save",
    cancelLabel: "Cancel",
  },
  async ({ values }, context) => {
    const league = values.league[0];
    
    if (league === "nhl") {
      const newConfig = {
        league: "nhl" as const,
        nhl: {
          teamAbbreviation: values.team[0],
          enablePostGameThreads: values.postGameThreads,
        },
      };
      await setSubredditConfig(context.subredditId, newConfig, context);
      
      // Trigger daily game finder immediately
      await context.scheduler.runJob({
        name: "nhl_daily_game_finder",
        data: {},
        runAt: new Date(),
      });
    }    

    context.ui.showToast("GameDayLive configured!");
  }
);

Devvit.addMenuItem({
  location: "subreddit",
  label: "Configure GameDayLive",
  description: "Set your league, team, and preferences",
  forUserType: "moderator",
  onPress: (_event, context) => {
    context.ui.showForm(configForm);
  },
});

export default Devvit;