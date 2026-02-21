import { NextResponse } from "next/server";

import {
  createNotification,
  listDueReminders,
  markReminderDelivered,
} from "@/lib/server/repository";

export async function POST() {
  try {
    const due = await listDueReminders({ at: new Date().toISOString() });
    for (const reminder of due) {
      await createNotification({
        userId: reminder.userId,
        title: "Reminder",
        body: reminder.text,
        linkUrl: "/",
      });
      await markReminderDelivered({ reminderId: reminder.id });
    }
    return NextResponse.json({ delivered: due.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
