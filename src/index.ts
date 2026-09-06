import { createApp } from "./app.js";
import { scheduleDailyReminders } from "./jobs/dailyReminders.js";
import { scheduleEmailQueueProcessor } from "./jobs/emailQueueProcessor.js";
import { scheduleEventReminders } from "./jobs/eventReminders.js";

const app = createApp();
const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`CLIENTIA backend à l'écoute sur http://localhost:${port}`);
});

scheduleEmailQueueProcessor();
scheduleDailyReminders();
scheduleEventReminders();
