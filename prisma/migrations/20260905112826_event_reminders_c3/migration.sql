/*
  Warnings:

  - You are about to drop the column `isSent` on the `EventReminder` table. All the data in the column will be lost.
  - You are about to drop the column `sentAt` on the `EventReminder` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_REMINDER';

-- DropForeignKey
ALTER TABLE "EmailQueue" DROP CONSTRAINT "EmailQueue_clientId_fkey";

-- DropForeignKey
ALTER TABLE "EmailQueue" DROP CONSTRAINT "EmailQueue_emailTemplateId_fkey";

-- AlterTable
ALTER TABLE "EmailQueue" ADD COLUMN     "directBody" TEXT,
ADD COLUMN     "directSubject" TEXT,
ADD COLUMN     "recipientUserId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL,
ALTER COLUMN "emailTemplateId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "EventReminder" DROP COLUMN "isSent",
DROP COLUMN "sentAt",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "EventReminderFiring" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceStartAt" TIMESTAMP(3) NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminderFiring_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventReminderFiring_eventId_idx" ON "EventReminderFiring"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventReminderFiring_reminderId_occurrenceStartAt_key" ON "EventReminderFiring"("reminderId", "occurrenceStartAt");

-- AddForeignKey
ALTER TABLE "EventReminderFiring" ADD CONSTRAINT "EventReminderFiring_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "EventReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminderFiring" ADD CONSTRAINT "EventReminderFiring_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailQueue" ADD CONSTRAINT "EmailQueue_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailQueue" ADD CONSTRAINT "EmailQueue_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailQueue" ADD CONSTRAINT "EmailQueue_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
