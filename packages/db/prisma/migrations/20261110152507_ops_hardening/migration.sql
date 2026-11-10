-- CreateTable
CREATE TABLE "rate_limit_bucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "reset_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "passport_view_daily" (
    "org_id" UUID NOT NULL,
    "passport_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "views" INTEGER NOT NULL,

    CONSTRAINT "passport_view_daily_pkey" PRIMARY KEY ("passport_id","day","source")
);

-- CreateIndex
CREATE INDEX "rate_limit_bucket_reset_at_idx" ON "rate_limit_bucket"("reset_at");

-- CreateIndex
CREATE INDEX "passport_view_daily_org_id_day_idx" ON "passport_view_daily"("org_id", "day");

-- Rate-limit counters: shared by API instances, not tenant data (keys are hashes), no need to survive a crash.
ALTER TABLE "rate_limit_bucket" SET UNLOGGED;
REVOKE TRUNCATE ON "rate_limit_bucket" FROM casitrace_app;
ALTER TABLE "rate_limit_bucket" ADD CONSTRAINT rate_limit_bucket_count CHECK (count >= 0);

-- Passport view counts: organisations read their own; anonymous page views increment through the
-- function below only (no direct writes by the app role).
ALTER TABLE "passport_view_daily" ENABLE ROW LEVEL SECURITY;
CREATE POLICY passport_view_daily_tenant ON "passport_view_daily" FOR SELECT TO casitrace_app
  USING (org_id = casitrace_current_org() OR casitrace_platform_access());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "passport_view_daily" FROM casitrace_app;
ALTER TABLE "passport_view_daily" ADD CONSTRAINT passport_view_daily_source CHECK (source IN ('qr', 'page'));
ALTER TABLE "passport_view_daily" ADD CONSTRAINT passport_view_daily_passport_fkey
  FOREIGN KEY ("passport_id") REFERENCES "passport"("id") ON DELETE CASCADE;

CREATE FUNCTION casitrace_count_passport_view(p_public_id text, p_source text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO passport_view_daily (org_id, passport_id, day, source, views)
  SELECT p.org_id, p.id, (now() AT TIME ZONE 'UTC')::date, p_source, 1
  FROM passport p WHERE p.public_id = p_public_id AND p.status IN ('published', 'withdrawn')
  ON CONFLICT (passport_id, day, source) DO UPDATE SET views = passport_view_daily.views + 1;
$$;
REVOKE ALL ON FUNCTION casitrace_count_passport_view(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION casitrace_count_passport_view(text, text) TO casitrace_app;
