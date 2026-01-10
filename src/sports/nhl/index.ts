import { Devvit } from "@devvit/public-api";
import { getSubredditConfig, updateSubredditSportConfig } from "../../core/config.js";
import { NHL_TEAMS } from "./config.js";
import { NHLConfig } from "../../types.js";
import { dailyGameFinder, pregameThread, liveUpdate } from "./scheduler.js";

  export function registerNHLModule(devvit: typeof Devvit) {
    // Register scheduler jobs
    devvit.addSchedulerJob({
      name: "nhl_daily_game_finder",
      onRun: dailyGameFinder,
    });

    devvit.addSchedulerJob({
      name: "nhl_pregame_thread",
      onRun: pregameThread,
    });

    devvit.addSchedulerJob({
      name: "nhl_live_update",
      onRun: liveUpdate,
    });

  // configuration form
  const nhlConfigForm = devvit.createForm(
    {
      fields: [
        {
          name: "team",
          label: "Your Team",
          type: "select",
          options: NHL_TEAMS,
          required: true,
        },
        {
          name: "GameDayThreads",
          label: "Create game day threads",
          type: "boolean",
          defaultValue: true,
        },
        {
          name: "postGameThreads",
          label: "Create post-game threads",
          type: "boolean",
          defaultValue: true,
        },
      ],
      title: "Configure NHL GameDayLive",
      acceptLabel: "Save",
      cancelLabel: "Cancel",
    },
    async ({ values }, context) => {
      const nhlConfig: NHLConfig = {
        teamAbbreviation: values.team[0],
        enablePostGameThreads: values.postGameThreads,
      };

      await updateSubredditSportConfig(
        context.subredditId,
        "nhl",
        nhlConfig,
        context
      );

      context.ui.showToast("NHL configuration saved!");
    }
  );
  
  devvit.addMenuItem({
    location: "subreddit",
    label: "Configure GameDayLive",
    description: "Select your team and game thread preferences",
    forUserType: "moderator",
    onPress: (_event, context) => {
      context.ui.showForm(nhlConfigForm);
    },
  });
}