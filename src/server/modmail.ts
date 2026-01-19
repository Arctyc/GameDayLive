import { context, reddit } from "@devvit/web/server";
import { Logger } from "./utils/Logger";

export async function sendModmail(subjectString: string, bodyString: string): Promise<string | undefined> {
    const logger = await Logger.Create(`Modmail - Send`);
    const subredditName = context.subredditName;
    try {
        const conversationId = await reddit.modMail.createModNotification({
            subject: subjectString,
            bodyMarkdown: bodyString,
            subredditId: context.subredditId,
        });
        return conversationId;
    } 
    catch (err) {
        logger.error(`Error sending Modmail: '${subjectString}' to sub: ${subredditName}`, err)
    }
}