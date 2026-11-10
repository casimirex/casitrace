-- Other organisations may learn exactly two facts about an organisation: that it exists (organisation
-- table) and whether Casitrace verified it. This view exposes only the verification status; it runs
-- with its owner's rights, so the rest of organization_profile stays under row-level security.
CREATE VIEW "organization_profile_public" AS
  SELECT org_id, verification_status FROM "organization_profile";
REVOKE ALL ON "organization_profile_public" FROM PUBLIC;
GRANT SELECT ON "organization_profile_public" TO casitrace_app;
