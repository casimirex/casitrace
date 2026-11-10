-- AddForeignKey
ALTER TABLE "passport_view_daily" ADD CONSTRAINT "passport_view_daily_passport_id_fkey" FOREIGN KEY ("passport_id") REFERENCES "passport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
