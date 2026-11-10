# CASITRACE

## Complete Product, Business & Technical Implementation Roadmap

**Project:** Casitrace  
**Category:** AgriFoodTech / Food Traceability / Digital Trust Infrastructure  
**Architecture:** Modular, domain-driven, API-first  
**Backend:** Bun + TypeScript  
**Frontend:** React + Vite + TypeScript  
**ORM:** Prisma  
**Database:** PostgreSQL  
**API:** REST + OpenAPI  
**AI:** Provider-independent AI integration  
**Infrastructure:** Docker + Cloud deployment  
**Development:** Claude Code, phase-by-phase implementation

---

# 1. Product Vision

Casitrace is an open, AI-powered food trust and traceability infrastructure that enables food businesses to create, exchange, manage and verify product information and evidence throughout the food supply chain.

The platform will connect:

- Farmers and agricultural producers.
- Food processors and manufacturers.
- Importers and exporters.
- Distributors and wholesalers.
- Restaurants and retailers.
- Certification bodies and auditors.
- Institutional buyers.
- Consumers.
- Government and regulatory stakeholders where integrations are available.

### Core value proposition

Every food product should have a verifiable digital history.

Casitrace will provide the infrastructure to establish:

1. Who produced the product?
2. Where was it produced?
3. What ingredients or raw materials were used?
4. How was it processed?
5. Which batches were involved?
6. Who handled the product?
7. Where did it move?
8. Which certifications and claims apply?
9. What evidence supports those claims?
10. Can the information be independently verified?

### Product positioning

Casitrace is not just:
- A farm management application.
- An inventory management system.
- A blockchain application.
- A QR-code generator.
- A regulatory compliance application.

It is a unified food trust infrastructure combining business identity, supply-chain traceability, evidence management, compliance, AI and digital product passports.

---

# 2. Product Architecture – Major Platforms

Build Casitrace as seven connected product layers.

## Layer 1: Business Identity Infrastructure

A public and private directory of food businesses.

Features:
- Business registration.
- Producer profiles.
- Manufacturer profiles.
- Distributor profiles.
- Restaurant profiles.
- Organization verification.
- Business locations.
- Production facilities.
- Farm registration.
- Certifications.
- Business relationships.
- Public business directory.
- Business verification status.
- Organization ownership and membership.

## Layer 2: Food Product Registry

A centralized registry of food products and their identities.

Features:
- Product registration.
- Product categories.
- Product classification.
- Product descriptions.
- Product images.
- Product ingredients.
- Raw material definitions.
- Origin information.
- Country of origin.
- Production methods.
- Allergens.
- Nutritional information.
- Packaging information.
- Storage conditions.
- Shelf life.
- Product specifications.
- Product versions.
- Product relationships.

## Layer 3: Supply Chain Traceability

The operational foundation of Casitrace.

Features:
- Raw material sourcing.
- Supplier management.
- Purchase records.
- Harvest records.
- Production batches.
- Processing batches.
- Transformation records.
- Batch splitting.
- Batch merging.
- Packaging.
- Warehousing.
- Inventory movements.
- Shipment records.
- Distribution.
- Receiving.
- Delivery confirmation.
- Returns.
- Recall management.
- End-to-end chain of custody.

Every important operation must generate a traceability event.

## Layer 4: Evidence & Verification Infrastructure

This differentiates Casitrace from conventional ERP software.

Features:
- Evidence document management.
- Certificates.
- Inspection reports.
- Laboratory reports.
- Supplier declarations.
- Production records.
- Geographic evidence.
- Photographic evidence.
- Digital signatures.
- Cryptographic hashes.
- Attestations.
- Evidence verification.
- Evidence expiry.
- Evidence revocation.
- Verification history.
- Audit trail.
- Public verification endpoints.

Important architectural principle:

A cryptographic hash can demonstrate that a document has not changed since hashing. It does not prove that the original document or the underlying claim is truthful.

Casitrace must distinguish:
- Evidence submitted.
- Evidence checked.
- Evidence independently verified.
- Claim attested by an authorized organization.
- Claim subsequently revoked or expired.

## Layer 5: Compliance & Regulatory Infrastructure

Build a configurable regulatory framework.

Initial regulatory areas:

- Food safety.
- Product traceability.
- Supplier due diligence.
- Food labeling.
- Allergen declarations.
- Organic certification.
- Sustainability claims.
- Deforestation-related due diligence.
- Product origin.
- Export documentation.
- Recall requirements.

Potential regulatory frameworks:

- EU General Food Law.
- EU food traceability requirements.
- EU Deforestation Regulation (EUDR).
- EU organic production regulations.
- EU General Product Safety requirements where applicable.
- GS1 traceability standards.
- Codex Alimentarius guidance.

Important: Regulatory applicability must be configurable by jurisdiction, commodity, business role and transaction date. Do not hardcode every regulation as a universal requirement.

EUDR should be implemented as a dedicated regulatory adapter, with applicability and implementation dates validated against current official EU sources.

## Layer 6: Digital Product Passport Infrastructure

Each registered product can have a digital identity and public information page.

Features:
- Product digital identity.
- QR code generation.
- Public product page.
- Producer identity.
- Product origin.
- Ingredient information.
- Batch information.
- Relevant certifications.
- Sustainability claims.
- Production information.
- Traceability timeline.
- Verification results.
- Product recall alerts.
- Multilingual consumer experience.
- Selective disclosure of commercially sensitive data.

QR codes should resolve through stable Casitrace URLs, not encode the entire product history.

## Layer 7: AI Intelligence Infrastructure

AI should be a platform-wide capability, not an isolated chatbot.

Features:
- AI compliance assistant.
- AI document extraction.
- AI certificate classification.
- AI evidence validation assistance.
- AI supplier onboarding assistant.
- AI product registration assistant.
- AI traceability assistant.
- AI regulatory guidance.
- AI missing-document detection.
- AI anomaly detection.
- AI audit preparation.
- AI recall investigation.
- AI supply-chain risk analysis.
- AI multilingual assistant.

AI must never independently certify products, approve regulatory compliance or fabricate missing evidence.

All consequential operations require deterministic validation and appropriate human authorization.

---

# 3. User Roles and Access Architecture

Implement RBAC with organization-level tenancy and resource-level permissions.

### Platform roles

- Platform Super Administrator.
- Platform Operations Administrator.
- Platform Compliance Administrator.
- Platform Auditor.
- Organization Owner.
- Organization Administrator.
- Farm Manager.
- Producer.
- Quality Manager.
- Production Manager.
- Warehouse Manager.
- Supply Chain Manager.
- Distributor.
- Retailer.
- Restaurant Operator.
- Compliance Officer.
- External Auditor.
- Consumer.
- API Integration Client.

### Multi-tenancy requirements

Each organization must have:
- Independent organizational identity.
- Members and permissions.
- Business locations.
- Facilities.
- Products.
- Suppliers.
- Customers.
- Certificates.
- Production records.
- Traceability records.
- Documents.
- Audit history.

Implement:
- Tenant isolation.
- Organization membership.
- Role-based permissions.
- Resource ownership.
- Cross-organization sharing.
- Explicit evidence-sharing permissions.
- Public/private data classification.

Never rely only on frontend permissions. Enforce authorization at the API and domain layers.

---

# 4. Complete Functional Module Catalogue

Organize the application into the following independently bounded modules.

| No. | Module         | Responsibility                         |
| --- | -------------- | -------------------------------------- |
| 01  | Identity       | Authentication and user identity       |
| 02  | Tenancy        | Multi-tenant isolation                 |
| 03  | Organizations  | Business and organization management   |
| 04  | Parties        | Suppliers, customers and stakeholders  |
| 05  | Directory      | Public food business registry          |
| 06  | Locations      | Farms, facilities and warehouses       |
| 07  | Products       | Product registry                       |
| 08  | Ingredients    | Raw materials and ingredients          |
| 09  | Suppliers      | Supplier onboarding and qualification  |
| 10  | Procurement    | Purchasing and sourcing                |
| 11  | Agriculture    | Farm and cultivation records           |
| 12  | Harvest        | Harvest operations and harvest batches |
| 13  | Production     | Food manufacturing and processing      |
| 14  | Lots           | Batch and lot management               |
| 15  | Traceability   | Product genealogy and chain of custody |
| 16  | Inventory      | Stock and warehouse management         |
| 17  | Logistics      | Shipment and transportation            |
| 18  | Orders         | Purchase and sales orders              |
| 19  | Documents      | Document storage and management        |
| 20  | Evidence       | Evidence and supporting records        |
| 21  | Certificates   | Certification management               |
| 22  | Attestations   | Cryptographically verifiable claims    |
| 23  | Verification   | Public and private verification        |
| 24  | Compliance     | Regulatory requirements                |
| 25  | Quality        | Inspections and quality management     |
| 26  | Testing        | Laboratory and test results            |
| 27  | Recalls        | Product recall management              |
| 28  | DPP            | Digital Product Passports              |
| 29  | QR             | QR generation and resolution           |
| 30  | Sustainability | Environmental and sustainability data  |
| 31  | Reporting      | Business and compliance reports        |
| 32  | Analytics      | Operational and supply-chain analytics |
| 33  | Notifications  | Alerts and communication               |
| 34  | Workflow       | Approval and operational workflows     |
| 35  | Audit          | Immutable audit history                |
| 36  | AI             | AI assistants and intelligence         |
| 37  | Integrations   | External systems and APIs              |
| 38  | Billing        | SaaS plans and subscriptions           |
| 39  | API Management | API keys, quotas and access            |
| 40  | Administration | Platform configuration                 |

Each module should have its own domain model, business rules, application services, repositories, API routes and tests.

Do not create 40 microservices immediately. Start with independently organized modules inside a modular monolith.

---

# 5. Technology Stack

## Backend

| Technology            | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| Bun                   | JavaScript runtime, package manager and tooling  |
| TypeScript            | Strongly typed application development           |
| Hono                  | Lightweight HTTP API framework                   |
| Prisma ORM            | Database access and migrations                   |
| PostgreSQL            | Primary relational database                      |
| Zod                   | Input and configuration validation               |
| OpenAPI               | API documentation and contracts                  |
| Pino                  | Structured logging                               |
| Vitest                | Unit and integration testing                     |
| Redis                 | Caching, rate limits and background coordination |
| S3-compatible storage | Documents, certificates and evidence             |

## Frontend

| Technology      | Purpose                |
| --------------- | ---------------------- |
| React           | UI framework           |
| Vite            | Frontend build tooling |
| TypeScript      | Type safety            |
| React Router    | Navigation             |
| TanStack Query  | Server state           |
| Zustand         | Client state           |
| React Hook Form | Forms                  |
| Zod             | Form validation        |
| Tailwind CSS    | Styling                |
| shadcn/ui       | UI components          |
| Recharts        | Analytics              |
| i18next         | Internationalization   |

## Infrastructure

- Docker.
- Docker Compose.
- PostgreSQL.
- Redis.
- S3-compatible object storage.
- GitHub Actions.
- OpenTelemetry.
- Error tracking.
- Cloud deployment.
- Automated database backups.

## Architectural decisions

1. TypeScript throughout the application.
2. Bun for backend execution and package management.
3. Prisma for relational persistence.
4. PostgreSQL as the system of record.
5. REST-first APIs with OpenAPI contracts.
6. Modular monolith initially.
7. Event-driven internal communication.
8. Transactional outbox for reliable event publishing.
9. Object storage for large evidence files.
10. Provider-independent AI integrations.

Use a workspace monorepo with separate backend and frontend applications.

---

# 6. Recommended Repository Structure

```text
casitrace/
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── bootstrap/
│   │   │   ├── config/
│   │   │   ├── middleware/
│   │   │   ├── modules/
│   │   │   ├── infrastructure/
│   │   │   ├── events/
│   │   │   ├── jobs/
│   │   │   ├── routes/
│   │   │   └── main.ts
│   │   └── tests/
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── layouts/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── stores/
│   │   │   ├── routes/
│   │   │   ├── lib/
│   │   │   └── main.tsx
│   │   └── tests/
│   │
│   └── worker/
│       └── src/
│           ├── jobs/
│           ├── consumers/
│           └── main.ts
│
├── packages/
│   ├── contracts/
│   ├── shared/
│   ├── config/
│   ├── api-client/
│   ├── validation/
│   ├── event-contracts/
│   └── test-utils/
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── docs/
│   ├── architecture/
│   ├── business/
│   ├── domain/
│   ├── api/
│   ├── security/
│   ├── compliance/
│   ├── decisions/
│   └── operations/
│
├── infrastructure/
│   ├── docker/
│   ├── deployment/
│   ├── monitoring/
│   └── scripts/
│
├── scripts/
│
├── .github/
│   └── workflows/
│
├── .env.example
├── biome.json
├── package.json
├── bun.lock
├── tsconfig.json
├── docker-compose.yml
├── CLAUDE.md
├── README.md
└── LICENSE
```

## Domain module structure

Each backend module follows a consistent structure.

Example:

```text
modules/
└── traceability/
    ├── domain/
    │   ├── entities/
    │   ├── value-objects/
    │   ├── events/
    │   ├── repositories/
    │   └── services/
    │
    ├── application/
    │   ├── commands/
    │   ├── queries/
    │   ├── handlers/
    │   └── use-cases/
    │
    ├── infrastructure/
    │   ├── persistence/
    │   ├── repositories/
    │   └── event-publishers/
    │
    ├── presentation/
    │   ├── routes/
    │   ├── controllers/
    │   └── schemas/
    │
    ├── traceability.module.ts
    └── index.ts
```

Use dependency inversion. Domain logic must not directly depend on Prisma, HTTP frameworks, external providers or AI SDKs.

---

# 7. Database Architecture

Use PostgreSQL with Prisma.

Organize database models by domain.

### Core tables

**Identity**
- User
- UserCredential
- UserSession
- OrganizationMembership
- Role
- Permission

**Tenancy and organizations**
- Tenant
- Organization
- OrganizationProfile
- BusinessRegistration
- OrganizationLocation
- Facility
- Party
- BusinessRelationship

**Product**
- Product
- ProductCategory
- ProductVariant
- ProductIngredient
- Ingredient
- ProductSpecification
- ProductVersion

**Supply chain**
- Supplier
- SupplierQualification
- PurchaseOrder
- SalesOrder
- Shipment
- ShipmentItem
- InventoryItem
- InventoryMovement

**Production**
- ProductionOrder
- ProductionRecord
- Batch
- BatchInput
- BatchOutput
- BatchTransformation
- HarvestRecord
- ProcessingRecord
- PackagingRecord

**Traceability**
- TraceabilityEvent
- TraceabilityRelationship
- ChainOfCustody
- BatchGenealogy
- Recall
- RecallItem

**Evidence**
- Document
- DocumentVersion
- Evidence
- EvidenceLink
- Certificate
- CertificateIssuer
- Attestation
- VerificationRecord
- RevocationRecord

**Compliance**
- Regulation
- RegulatoryRequirement
- ComplianceFramework
- ComplianceAssessment
- ComplianceEvidence
- ComplianceFinding

**Digital Product Passport**
- DigitalProductPassport
- PassportVersion
- PassportData
- QRCode
- PublicAccessToken

**Platform**
- AuditLog
- OutboxEvent
- Notification
- Workflow
- WorkflowExecution
- Subscription
- ApiKey
- Integration

### Important database design rules

1. Every tenant-owned record must have explicit tenant ownership.
2. Every organization-owned record must have organization ownership.
3. Use UUID identifiers.
4. Use UTC timestamps.
5. Use database transactions for multi-record business operations.
6. Use soft deletion selectively, not universally.
7. Never physically delete regulatory or audit evidence when retention obligations apply.
8. Version products and published passports.
9. Preserve historical batch relationships.
10. Use append-only records for critical traceability events.
11. Index frequently queried batch, product and organization identifiers.
12. Define data retention and privacy policies.

Do not make the mistake of storing the entire traceability history as a JSON document inside one product record.

Use normalized relational records and structured events.

---

# 8. Implementation Roadmap – Development Phases

The following phases are designed to be executed sequentially using Claude Code.

Each phase must have:
- Functional requirements.
- Technical implementation.
- Database changes.
- API contracts.
- Frontend screens where applicable.
- Unit tests.
- Integration tests.
- Security review.
- Documentation.
- Completion verification.

## PHASE 00 – Product Discovery and Technical Foundation

**Objective:** Establish the complete product foundation before writing business logic.

Deliverables:

- Product requirements document.
- Business requirements document.
- Functional specification.
- Non-functional requirements.
- User personas.
- User journeys.
- Domain glossary.
- System architecture.
- Architecture decision records.
- Initial data model.
- API conventions.
- Coding standards.
- Development standards.

Create these documents:

```text
docs/
├── business/
│   ├── product-vision.md
│   ├── business-model.md
│   ├── personas.md
│   ├── user-journeys.md
│   └── functional-requirements.md
│
└── architecture/
    ├── system-architecture.md
    ├── domain-model.md
    ├── database-strategy.md
    ├── api-standards.md
    ├── security-architecture.md
    └── adr/
```

**Acceptance criteria:**
- All core domains are documented.
- Domain boundaries are defined.
- Initial workflows are documented.
- Architectural decisions are recorded.
- Claude Code has sufficient project context.

## PHASE 01 – Monorepo and Development Infrastructure

**Objective:** Create the actual project from scratch.

Implement:

- Bun workspace configuration.
- React + Vite application.
- TypeScript configuration.
- Hono API application.
- Prisma integration.
- PostgreSQL.
- Redis.
- Docker Compose.
- Environment configuration.
- Shared packages.
- Biome linting and formatting.
- Vitest.
- Git hooks if required.
- GitHub Actions CI.

Deliver:

```text
casitrace/
├── apps/api
├── apps/web
├── apps/worker
├── packages
├── prisma
├── docs
├── infrastructure
└── CLAUDE.md
```

**Acceptance criteria:**
- `bun install` succeeds.
- Backend starts.
- Frontend starts.
- Database connects.
- Prisma migration works.
- Health endpoint responds.
- CI executes successfully.
- All applications share consistent TypeScript standards.

## PHASE 02 – Core Identity, Tenancy and Authorization

**Objective:** Build the foundation of the entire platform.

Implement:

1. User registration.
2. User login.
3. Password hashing.
4. Email verification.
5. Password reset.
6. Session management.
7. Organization registration.
8. Organization membership.
9. Multi-tenant architecture.
10. Roles and permissions.
11. Organization invitations.
12. Organization switching.
13. Account settings.
14. Audit logging.

Security requirements:

- Secure password hashing.
- Secure session cookies.
- CSRF protection where applicable.
- Rate limiting.
- Login attempt protection.
- Tenant isolation.
- Permission enforcement.
- Secure secrets management.

**Acceptance criteria:**
- Users can register and authenticate.
- Users can belong to multiple organizations.
- Organizations cannot access each other's private records.
- Permissions are enforced server-side.
- Security tests cover cross-tenant access.

## PHASE 03 – Organization Registry and Public Directory

**Objective:** Build the business identity infrastructure.

Implement:

- Business registration.
- Organization profiles.
- Legal business details.
- Business classifications.
- Food business categories.
- Farm profiles.
- Manufacturing profiles.
- Distributor profiles.
- Retailer profiles.
- Business locations.
- Facilities.
- Geographic information.
- Organization verification workflows.
- Certificate associations.
- Public directory.
- Search and filtering.
- Organization profile publishing.

Frontend:
- Organization onboarding wizard.
- Business dashboard.
- Business profile editor.
- Facility management.
- Public directory.
- Public organization profile.

**Acceptance criteria:**
- Businesses can register and publish profiles.
- Verification status is explicit.
- Public and private information is separated.
- Search works efficiently.

## PHASE 04 – Product Registry and Master Data

**Objective:** Establish a standardized product and ingredient registry.

Implement:

- Product creation.
- Product classification.
- Product categories.
- Ingredient registry.
- Product composition.
- Product specifications.
- Allergen information.
- Nutritional information.
- Country of origin.
- Product images.
- Packaging information.
- Storage conditions.
- Shelf-life information.
- Product versioning.
- Product publishing.

Create a configurable classification architecture.

Support future integration with:
- GS1 identifiers.
- GTIN.
- GLN.
- Other relevant industry identifiers.

**Acceptance criteria:**
- Products have stable identities.
- Product versions preserve history.
- Ingredient relationships are traceable.
- Products can be associated with organizations and facilities.

## PHASE 05 – Supplier, Procurement and Sourcing

**Objective:** Connect businesses and establish the sourcing foundation.

Implement:

- Supplier directory.
- Customer directory.
- Business relationships.
- Supplier invitations.
- Supplier onboarding.
- Supplier verification.
- Supplier qualifications.
- Purchase orders.
- Purchase order items.
- Sourcing records.
- Raw material receipts.
- Supplier declarations.
- Supplier document collection.
- Supplier approval workflows.

**Acceptance criteria:**
- Businesses can establish trusted supplier relationships.
- Purchase records can be linked to suppliers and products.
- Received raw materials can be associated with batch records.

## PHASE 06 – Agriculture and Harvest Management

**Objective:** Support agricultural producers.

Implement:

- Farm registration.
- Farm locations.
- Field and plot management.
- Geospatial boundaries.
- Crop management.
- Planting records.
- Cultivation activities.
- Irrigation records.
- Fertilizer records.
- Pesticide application records.
- Harvest planning.
- Harvest execution.
- Harvest quantities.
- Harvest dates.
- Harvest batch creation.
- Agricultural evidence.

Geospatial capabilities:

- GeoJSON support.
- PostgreSQL PostGIS when required.
- Farm polygon storage.
- Geographic validation.
- Location history.

**Acceptance criteria:**
- Farmers can register farms and fields.
- Agricultural activities are recorded.
- Harvest operations create traceable batches.
- Evidence can be associated with each operation.

## PHASE 07 – Manufacturing and Batch Management

**Objective:** Implement the core food production and transformation engine.

This is one of the most important phases.

Implement:

- Production orders.
- Production facilities.
- Production lines.
- Recipes and formulations.
- Raw material consumption.
- Batch creation.
- Batch splitting.
- Batch merging.
- Processing operations.
- Transformation records.
- Packaging.
- Finished goods.
- Production quantities.
- Waste and yield records.
- Quality checkpoints.
- Production approvals.

### Batch genealogy

Example:

```text
Raw Material A ──┐
                 ├── Production Batch 001
Raw Material B ──┘
                          |
                          v
                    Processing
                          |
                          v
                    Finished Batch 001
                          |
                 ┌────────┴────────┐
                 v                 v
              Lot 001           Lot 002
```

Every transformation must preserve parent-child relationships.

Implement a traceability graph using relational records and event history.

**Acceptance criteria:**
- Every batch has a unique identifier.
- Inputs and outputs are linked.
- Batch splitting and merging preserve genealogy.
- Historical records cannot be silently rewritten.
- Production events are auditable.

## PHASE 08 – End-to-End Traceability Engine

**Objective:** Build the central intelligence layer connecting the complete supply chain.

Implement:

- Traceability events.
- Event ingestion.
- Event validation.
- Batch genealogy.
- Chain of custody.
- Shipment tracking.
- Dispatch records.
- Receipt confirmation.
- Transfer of ownership.
- Product location history.
- Traceability timelines.
- Backward traceability.
- Forward traceability.
- Batch search.
- Recall impact analysis.

Consider GS1 EPCIS 2.0 as an interoperability target.

Design an internal canonical traceability model that can map to external event standards.

Do not tightly couple the internal database to one external standard.

### Important use cases

**Forward traceability:**

Given a raw material batch, identify every downstream product and customer affected.

**Backward traceability:**

Given a finished product batch, identify all contributing ingredients, suppliers and original batches.

**Recall investigation:**

Given a defective batch, identify all related products, shipments, customers and locations.

**Acceptance criteria:**
- Complete backward traceability works.
- Complete forward traceability works.
- Batch genealogy is consistent.
- Recall impact can be calculated.
- Traceability events are auditable.

## PHASE 09 – Evidence, Documents and Certificates

**Objective:** Build the evidence management infrastructure.

Implement:

- Document upload.
- Document categorization.
- Secure object storage.
- Document versioning.
- Document metadata.
- Evidence registration.
- Evidence-to-product relationships.
- Evidence-to-batch relationships.
- Evidence-to-organization relationships.
- Certificate management.
- Certificate issuers.
- Expiry tracking.
- Certificate verification.
- Evidence approval.
- Evidence rejection.
- Evidence revocation.

Document processing:
- File type validation.
- Malware scanning.
- OCR.
- Metadata extraction.
- AI classification.
- Human review.

### Evidence integrity

For each evidence file:

1. Calculate SHA-256 hash.
2. Store file metadata.
3. Record uploader and organization.
4. Record upload time.
5. Record evidence version.
6. Record verification status.
7. Record approval or rejection.
8. Preserve the verification history.

Do not expose confidential documents through public URLs.

**Acceptance criteria:**
- Documents are securely stored.
- Evidence can be linked to traceability records.
- Document integrity can be checked.
- Certificate expiration generates alerts.
- Verification history is preserved.

## PHASE 10 – Cryptographic Attestation and Verification

**Objective:** Create the trust layer.

Implement:

- Attestation creation.
- Attestation schemas.
- Claim definitions.
- Issuer identity.
- Digital signatures.
- Signature verification.
- Evidence references.
- Cryptographic hashes.
- Attestation expiration.
- Revocation.
- Verification history.
- Public verification APIs.

Consider the following standards:

- W3C Verifiable Credentials Data Model 2.0.
- W3C Data Integrity.
- Suitable digital signature standards.
- Content-addressed document integrity.

Design a provider-independent cryptographic interface.

Example:

```typescript
interface AttestationService {
  issue(input: IssueAttestationInput): Promise<Attestation>;

  verify(attestationId: string): Promise<VerificationResult>;

  revoke(attestationId: string, reason: string): Promise<void>;
}
```

Important:

Do not introduce a blockchain dependency at the beginning.

Use cryptographic hashes and digital signatures first. If there is a genuine multi-party trust requirement, evaluate a public blockchain or another independent anchoring mechanism later.

**Acceptance criteria:**
- Attestations can be issued by authorized issuers.
- Signatures can be independently verified.
- Revoked attestations are identifiable.
- Verification does not require exposing private business documents.

## PHASE 11 – Compliance and Regulatory Engine

**Objective:** Convert regulatory obligations into operational workflows.

Implement:

- Regulatory framework registry.
- Jurisdiction registry.
- Regulatory requirement definitions.
- Product applicability.
- Business applicability.
- Compliance checklists.
- Evidence requirements.
- Compliance assessments.
- Missing evidence detection.
- Expiry monitoring.
- Compliance reports.
- Audit preparation.
- Corrective action management.

Initial regulatory adapters:

1. Food traceability.
2. Food safety.
3. Supplier due diligence.
4. Organic certification.
5. Product labeling.
6. EUDR where applicable.

### Compliance engine design

Use configurable rules instead of hardcoded business conditions.

Example:

```typescript
interface ComplianceRule {
  id: string;
  frameworkId: string;
  jurisdiction: string;
  applicableEntityTypes: string[];
  evaluate(context: ComplianceContext): Promise<ComplianceResult>;
}
```

Rules must be versioned and effective-dated.

Compliance results should distinguish:
- Compliant.
- Non-compliant.
- Partially compliant.
- Pending evidence.
- Not applicable.
- Requires human review.

**Acceptance criteria:**
- Rules can be added without rewriting core traceability logic.
- Assessments are reproducible.
- Evidence is linked to requirements.
- Compliance results have a clear audit trail.

## PHASE 12 – Digital Product Passport and QR Infrastructure

**Objective:** Give every published product a public digital identity.

Implement:

- Passport creation.
- Passport templates.
- Product passport data.
- Batch-specific information.
- Passport versioning.
- Public/private field classification.
- QR code generation.
- Stable QR resolution.
- Public product pages.
- Verification status.
- Certificate information.
- Product origin.
- Product journey.
- Consumer-friendly information.
- Multilingual pages.

### Public product journey

```text
Consumer scans QR
       |
       v
Casitrace public URL
       |
       v
Resolve product / batch
       |
       v
Load published passport
       |
       v
Verify relevant attestations
       |
       v
Display verified information
```

Never expose confidential supplier agreements, private documents, personal information or commercially sensitive transaction data.

**Acceptance criteria:**
- QR codes resolve correctly.
- Published passports are versioned.
- Public data respects access policies.
- Consumers can verify the information displayed.

## PHASE 13 – AI Assistants and Intelligence

**Objective:** Introduce AI capabilities across Casitrace.

Create a dedicated AI module with provider abstraction.

### AI assistants

**1. Producer Assistant**
- Product registration.
- Farm record assistance.
- Agricultural documentation.
- Evidence preparation.

**2. Supplier Assistant**
- Supplier onboarding.
- Document collection.
- Certificate checks.
- Missing information detection.

**3. Compliance Assistant**
- Regulatory explanations.
- Checklist generation.
- Evidence mapping.
- Compliance preparation.

**4. Traceability Assistant**
- Natural-language batch search.
- Product journey explanations.
- Supplier relationship analysis.
- Recall investigation assistance.

**5. Manufacturer Assistant**
- Production record assistance.
- Batch documentation.
- Quality report summaries.

**6. Consumer Assistant**
- Product origin explanations.
- Ingredient information.
- Certification explanations.
- Product history summaries.

### AI architecture

```text
React Application
       |
       v
AI API Gateway
       |
       v
AI Orchestrator
       |
       ├── Provider Adapter
       ├── Prompt Registry
       ├── Context Retrieval
       ├── Tool Registry
       ├── Permission Engine
       ├── Output Validation
       └── Audit Logging
```

Use structured output schemas.

AI tools must call existing authorized application services, never directly mutate database tables.

Add:
- Prompt versioning.
- Model observability.
- Token usage tracking.
- Tenant-level AI quotas.
- Human approval for consequential actions.
- AI output validation.
- Data access controls.

## PHASE 14 – Reporting, Analytics and Notifications

Implement:

- Organization dashboard.
- Product dashboard.
- Batch dashboard.
- Supplier dashboard.
- Traceability reports.
- Compliance reports.
- Certificate expiry reports.
- Missing evidence reports.
- Recall reports.
- Product analytics.
- Operational metrics.
- Notification preferences.
- Email notifications.
- In-app notifications.
- Webhooks.

Introduce materialized views or analytics storage when reporting workloads justify it.

Do not burden transactional queries with expensive reporting workloads.

## PHASE 15 – API and Interoperability Platform

**Objective:** Make Casitrace an infrastructure platform that external systems can integrate with.

Implement:

- REST APIs.
- OpenAPI specifications.
- API key management.
- OAuth 2.0 where appropriate.
- Webhooks.
- Webhook retries.
- Idempotency keys.
- Rate limits.
- API usage analytics.
- External organization integrations.
- Import/export.
- Data mapping.
- API versioning.

Potential integrations:

- ERP systems.
- Farm management software.
- Manufacturing software.
- Logistics platforms.
- Laboratory systems.
- Certification platforms.
- Retail systems.
- GS1 ecosystem.
- External regulatory services.

Design integration adapters independently of the domain modules.

## PHASE 16 – Billing and SaaS Commercialization

Implement:

- Subscription plans.
- Organization subscriptions.
- Usage metering.
- Product limits.
- Batch limits.
- Document storage quotas.
- API quotas.
- AI usage quotas.
- Billing records.
- Invoices.
- Payment integration.
- Trial periods.
- Subscription lifecycle.
- Upgrade and downgrade.
- Enterprise contracts.

Suggested commercial packaging:

**Free**
- Basic business profile.
- Limited product registration.
- Basic QR pages.

**Producer**
- Farm management.
- Harvest records.
- Batch traceability.
- Evidence management.

**Business**
- Supplier management.
- Production.
- Traceability.
- Compliance.
- Digital passports.

**Enterprise**
- Multi-facility.
- Advanced workflows.
- APIs.
- Integrations.
- Advanced analytics.
- Enterprise support.

**Infrastructure/API**
- Verification API.
- Passport API.
- Attestation API.
- Integration services.

Pricing should be validated through actual customer interviews and pilots.

## PHASE 17 – Security, Performance and Production Hardening

Implement:

- Security audit.
- Threat modeling.
- Tenant isolation testing.
- Permission testing.
- Dependency scanning.
- Vulnerability scanning.
- Database backup and recovery.
- Disaster recovery.
- Rate limiting.
- Abuse prevention.
- Encryption.
- Data retention.
- Privacy controls.
- Observability.
- Application metrics.
- Distributed tracing.
- Performance profiling.
- Load testing.
- Migration testing.

Important:

- Maintain an append-only audit history for critical operations.
- Protect signing keys through secure key management.
- Support key rotation.
- Keep document storage private by default.
- Implement secure public verification endpoints.
- Establish incident response procedures.

**Acceptance criteria:**
- Security tests pass.
- Backup restoration is demonstrated.
- Critical workflows meet performance targets.
- Production monitoring is functional.
- Release and rollback procedures are documented.

## PHASE 18 – Pilot Launch and Commercial Validation

**Objective:** Launch a working Casitrace ecosystem with actual businesses.

Start with one manageable supply chain.

Recommended pilot:

**Agricultural producer → Food processor → Distributor → Retailer → Consumer**

Example product:
- Tomatoes.
- Olive oil.
- Coffee.
- Dairy.
- Other products depending on pilot-partner availability.

Pilot functionality:

1. Business onboarding.
2. Product registration.
3. Supplier registration.
4. Batch creation.
5. Production records.
6. Batch genealogy.
7. Evidence uploads.
8. Traceability.
9. QR passport.
10. Public verification.

Measure:

- Time required to onboard a business.
- Time required to register a product.
- Time required to create a batch.
- Percentage of batches with complete traceability.
- Evidence completeness.
- Verification success rate.
- QR scan engagement.
- Recall investigation time.
- Customer willingness to pay.

Do not launch every regulatory framework and every AI feature before validating the core workflow.

---

# 9. Frontend Application Architecture

Create separate experiences for different user types.

### A. Business Portal

Primary workspace for food businesses.

Screens:
- Dashboard.
- Organization profile.
- Business directory.
- Locations.
- Facilities.
- Products.
- Ingredients.
- Suppliers.
- Procurement.
- Production.
- Harvest.
- Batches.
- Traceability.
- Inventory.
- Shipments.
- Documents.
- Evidence.
- Certificates.
- Compliance.
- Digital passports.
- Analytics.
- Notifications.
- Settings.

### B. Public Directory

Public-facing discovery experience.

Screens:
- Search businesses.
- Business profiles.
- Producer profiles.
- Product categories.
- Product discovery.
- Verified organizations.

### C. Consumer Portal

Screens:
- QR landing page.
- Product passport.
- Product origin.
- Product ingredients.
- Product journey.
- Certification information.
- Verification results.

### D. Platform Administration

Screens:
- Platform dashboard.
- Organization management.
- User management.
- Business verification.
- Certificate issuers.
- Regulatory frameworks.
- Attestation management.
- API management.
- AI usage.
- Subscription management.
- Audit logs.

---

# 10. Critical Business Workflows

Claude Code must implement actual business workflows rather than isolated CRUD endpoints.

### Workflow A – Business onboarding

```text
Register
  → Verify email
  → Create organization
  → Add business information
  → Add locations
  → Invite team
  → Submit verification
  → Review
  → Publish profile
```

### Workflow B – Product registration

```text
Select organization
  → Create product
  → Add ingredients
  → Add origin
  → Add specifications
  → Upload supporting evidence
  → Validate
  → Publish product
```

### Workflow C – Supplier sourcing

```text
Create supplier
  → Invite supplier
  → Supplier registration
  → Collect certificates
  → Review documents
  → Approve supplier
  → Create purchase order
  → Receive raw material
  → Register incoming batch
```

### Workflow D – Manufacturing

```text
Create production order
  → Select raw material batches
  → Validate available quantities
  → Start production
  → Record transformation
  → Generate output batch
  → Record packaging
  → Quality approval
  → Release finished product
```

### Workflow E – Product traceability

```text
Raw material
  → Production
  → Processing
  → Packaging
  → Warehouse
  → Shipment
  → Distributor
  → Retailer
  → Consumer
```

### Workflow F – Evidence verification

```text
Upload document
  → Validate file
  → Calculate hash
  → Extract metadata
  → Link evidence
  → Submit for review
  → Verify issuer / source
  → Approve or reject
  → Create attestation if authorized
```

### Workflow G – Product passport

```text
Select product / batch
  → Gather authorized information
  → Validate required fields
  → Check evidence status
  → Generate passport version
  → Publish
  → Generate QR
  → Verify public presentation
```

---

# 11. Development Rules for Claude Code

These rules must be placed in the root `CLAUDE.md`.

## Engineering standards

1. Follow clean architecture.
2. Follow domain-driven design.
3. Use TypeScript strict mode.
4. Avoid unnecessary abstractions.
5. Avoid `any`.
6. Keep business logic independent of frameworks.
7. Use dependency inversion.
8. Separate domain, application, infrastructure and presentation layers.
9. Use Prisma only in persistence implementations.
10. Validate all incoming API data.
11. Use explicit DTOs.
12. Never expose Prisma models directly through API responses.
13. Use structured errors.
14. Use transactions for critical workflows.
15. Implement idempotency for retryable operations.
16. Implement pagination for list endpoints.
17. Use database indexes appropriately.
18. Avoid N+1 queries.
19. Use consistent naming conventions.
20. Write tests for business logic.

## Database rules

- All migrations must be version controlled.
- Never use schema push as a production migration strategy.
- Never silently overwrite historical traceability records.
- Use transactions for batch transformations.
- Enforce foreign-key relationships.
- Use explicit ownership.
- Test tenant isolation.
- Maintain event history.
- Use decimal types for quantities and financial values where precision matters.

## API rules

- REST conventions.
- Versioned API.
- OpenAPI documentation.
- Consistent error responses.
- Request validation.
- Response DTOs.
- Pagination.
- Rate limiting.
- Idempotency.
- Authorization.
- Audit logging.

## Frontend rules

- Feature-based organization.
- Reusable UI components.
- Typed API clients.
- Centralized error handling.
- Accessible forms.
- Loading and empty states.
- Responsive layouts.
- Permission-aware navigation.
- No direct database access.
- No duplicated business rules in frontend.

## Testing rules

Every phase must include:

- Unit tests.
- Integration tests.
- API tests.
- Database tests where applicable.
- Authorization tests.
- Tenant isolation tests.
- End-to-end tests for critical workflows.

---

# 12. Claude Code Execution Strategy

Do not ask Claude Code to build the entire platform in one prompt.

Use a controlled implementation workflow.

### Step 1 – Initialize the repository

Give Claude Code the complete product roadmap and ask it to analyze the project before coding.

### Step 2 – Architecture first

Ask Claude Code to produce:
- Architecture documentation.
- Domain boundaries.
- Database design.
- API standards.
- Module dependencies.
- ADRs.

Review these documents before proceeding.

### Step 3 – Implement one phase at a time

For each phase:

1. Read the complete project documentation.
2. Inspect existing implementation.
3. Identify dependencies.
4. Produce an implementation plan.
5. Implement the backend.
6. Implement the frontend.
7. Create database migrations.
8. Write tests.
9. Run tests.
10. Run lint and type checks.
11. Review security.
12. Update documentation.
13. Produce a completion report.

### Step 4 – Never skip verification

A phase is complete only when its acceptance criteria are satisfied.

If tests fail, fix them before moving forward.

### Step 5 – Preserve architectural consistency

Claude Code must never:
- Rebuild existing functionality unnecessarily.
- Duplicate domain models.
- Introduce unnecessary dependencies.
- Mix unrelated modules.
- Bypass application services.
- Implement fake integrations.
- Replace real business logic with static mock data in production.
- Introduce blockchain merely for marketing purposes.

---

# 13. Master Prompt for Claude Code

Use this as the initial instruction after creating the repository.

## PROMPT 1 – Project Initialization

You are the principal software architect and senior full-stack engineering lead responsible for building Casitrace.

Casitrace is an enterprise-grade, AI-powered food traceability and digital trust infrastructure platform.

Your responsibility is to build this platform from scratch using:

- Bun.
- TypeScript.
- Hono.
- Prisma ORM.
- PostgreSQL.
- Redis.
- React.
- Vite.
- Tailwind CSS.
- shadcn/ui.
- OpenAPI.
- Docker.

Follow clean architecture, domain-driven design, SOLID principles, modular design and production-grade engineering practices.

Read the complete Casitrace product specification and implementation roadmap before beginning.

IMPORTANT REQUIREMENTS:

1. Start by analyzing the complete requirements.
2. Create a detailed architecture.
3. Establish bounded contexts.
4. Define module dependencies.
5. Design the database architecture.
6. Create the monorepo.
7. Establish coding standards.
8. Configure development infrastructure.
9. Create the root CLAUDE.md.
10. Do not implement all business modules immediately.

Your first task is to implement PHASE 00 and PHASE 01 only.

Create the complete repository structure, infrastructure, development tooling and architectural documentation.

Before implementing, provide an implementation plan.

After implementation:

- Run all available checks.
- Verify frontend startup.
- Verify backend startup.
- Verify PostgreSQL connectivity.
- Verify Prisma migrations.
- Verify CI configuration.
- Document all decisions.

Do not proceed to PHASE 02 until the current phase has been reviewed and approved.

## PROMPT 2 – Phase Implementation Template

Use this prompt for every subsequent phase.

You are continuing development of Casitrace.

Read:

- CLAUDE.md.
- Product specification.
- Architecture documentation.
- Relevant domain documentation.
- Existing database schema.
- Existing implementation.
- Previous phase completion reports.

Implement PHASE [NUMBER]: [PHASE NAME].

Requirements:

1. Understand the existing architecture.
2. Identify dependencies and integration points.
3. Prepare a detailed implementation plan.
4. Define domain entities and business rules.
5. Implement domain logic.
6. Implement application use cases.
7. Implement persistence using Prisma.
8. Implement API endpoints using Hono.
9. Update OpenAPI specifications.
10. Implement frontend functionality using React and TypeScript.
11. Add validation and error handling.
12. Implement authorization.
13. Write unit tests.
14. Write integration tests.
15. Write end-to-end tests for critical workflows.
16. Execute migrations.
17. Run TypeScript checks.
18. Run linting.
19. Run the complete test suite.
20. Review security and tenant isolation.
21. Update documentation.

STRICT RULES:

- Do not duplicate existing functionality.
- Do not bypass clean architecture.
- Do not expose Prisma models directly.
- Do not use untyped objects.
- Do not leave incomplete business logic.
- Do not use mock implementations in production workflows.
- Do not break existing functionality.
- Do not silently change existing database contracts.
- Do not introduce unnecessary dependencies.
- Do not proceed when critical tests fail.

At completion, provide:

- Features implemented.
- Files created.
- Files modified.
- Database changes.
- API endpoints.
- Frontend screens.
- Tests executed.
- Test results.
- Security considerations.
- Known limitations.
- Acceptance criteria status.

Stop after completing this phase and wait for approval.

## PROMPT 3 – Independent Phase Audit

Act as an independent principal engineer conducting a technical audit of the completed Casitrace phase.

Do not assume the implementation is correct.

Inspect the actual code and verify:

1. Architecture compliance.
2. Domain boundaries.
3. Type safety.
4. Database integrity.
5. Prisma usage.
6. API consistency.
7. OpenAPI accuracy.
8. Authorization.
9. Multi-tenant isolation.
10. Security.
11. Performance.
12. Test coverage.
13. Error handling.
14. Logging.
15. Documentation.
16. Backward compatibility.

Identify:
- Critical defects.
- Security vulnerabilities.
- Architectural violations.
- Data consistency problems.
- Missing business operations.
- Incomplete functionality.
- Unnecessary complexity.

Fix all issues that can safely be fixed within the current phase.

Run the tests again.

Produce a final audit report.

Do not claim completion based on generated code alone. Verify actual execution and test results.

---

# 14. Suggested Development Milestones

These are planning estimates, not guaranteed delivery dates.

| Milestone | Included phases | Outcome                           |
| --------- | --------------- | --------------------------------- |
| M0        | 00–01           | Engineering foundation            |
| M1        | 02–03           | Business identity platform        |
| M2        | 04–05           | Product and supplier registry     |
| M3        | 06–07           | Agriculture and production        |
| M4        | 08              | End-to-end traceability           |
| M5        | 09–10           | Evidence and trust infrastructure |
| M6        | 11–12           | Compliance and product passports  |
| M7        | 13–14           | AI and intelligence               |
| M8        | 15–16           | Integration and monetization      |
| M9        | 17–18           | Production launch and pilot       |

### Recommended initial MVP

Do not attempt to deliver all 18 phases before testing the business.

The first commercially demonstrable MVP should include:

1. Business registration.
2. Organization directory.
3. Product registration.
4. Supplier management.
5. Batch creation.
6. Batch transformation.
7. Batch genealogy.
8. Evidence upload.
9. Basic certificate management.
10. Traceability timeline.
11. QR product passport.
12. Public verification.

This provides a complete, demonstrable food traceability journey.

---

# 15. Business Model and Market Entry

Casitrace should be developed as a B2B SaaS platform with a public verification layer.

### Revenue opportunities

| Revenue stream               | Potential customer               |
| ---------------------------- | -------------------------------- |
| SaaS subscription            | Producers and food businesses    |
| Enterprise licensing         | Manufacturers and distributors   |
| Product passport fees        | Brands and manufacturers         |
| API subscriptions            | Third-party software providers   |
| Verification services        | Buyers and supply-chain partners |
| AI compliance services       | Food businesses                  |
| Enterprise integrations      | Large food organizations         |
| Supplier onboarding services | Enterprise supply chains         |

### Initial go-to-market strategy

Start with one geographical market and one supply-chain vertical.

Recommended sequence:

1. Recruit 3–5 agricultural producers.
2. Recruit 1–2 food processors.
3. Recruit at least one distributor or retailer.
4. Register real products.
5. Track real production batches.
6. Generate product passports.
7. Test independent verification.
8. Measure operational improvements.
9. Obtain customer feedback.
10. Convert successful pilot participants into paying customers.

The goal is to prove that Casitrace reduces documentation friction, improves traceability and creates measurable commercial value.

---

# 16. Product Differentiation – Future Opportunities

Once the core infrastructure works, expand beyond conventional traceability.

### A. Trust Graph

Build a graph of relationships between:

- Producers.
- Suppliers.
- Products.
- Ingredients.
- Batches.
- Facilities.
- Certificates.
- Attestations.
- Distributors.
- Retailers.

This can power advanced supplier discovery, risk analysis and product genealogy.

### B. Universal Food Identity

Give every registered product and batch a persistent digital identity that can be resolved across different systems.

### C. Evidence Exchange Network

Allow authorized businesses to exchange verified evidence without repeatedly requesting the same documentation.

### D. AI Supply Chain Risk Intelligence

Detect:
- Missing supplier evidence.
- Expired certificates.
- Unexpected sourcing changes.
- Inconsistent batch quantities.
- Suspicious traceability gaps.
- Unusual product movements.

### E. Food Recall Intelligence

Identify affected downstream batches and customers rapidly, using actual batch genealogy.

### F. Open Verification Infrastructure

Allow external systems and consumers to verify public claims using Casitrace verification APIs.

### G. Interoperable Food Data

Support GS1 identifiers, EPCIS event exchange, structured product information and suitable verifiable credential standards.

The long-term opportunity is to become infrastructure that other food-industry applications can integrate with rather than requiring every business to replace its existing ERP.

---

# 17. Final Engineering Principles

The following principles should guide the entire Casitrace project:

1. Build a real business platform, not a demonstration application.
2. Make traceability the central domain.
3. Treat evidence as a first-class entity.
4. Separate claims from verified facts.
5. Keep business identity independent from product identity.
6. Maintain complete batch genealogy.
7. Protect commercially sensitive information.
8. Make interoperability a core requirement.
9. Use open standards where appropriate.
10. Make regulatory rules configurable.
11. Keep AI provider-independent.
12. Keep cryptographic verification independent of blockchain.
13. Use modular architecture without premature microservices.
14. Enforce tenant isolation everywhere.
15. Test every critical business operation.
16. Maintain backward-compatible API contracts.
17. Document every important architectural decision.
18. Validate the business through actual supply-chain pilots.

---

# 18. Definition of Success

Casitrace should eventually demonstrate this complete journey:

A producer registers a business and farm, creates a product, documents its production practices, records a harvest batch, and attaches supporting evidence.

A manufacturer purchases the raw material, receives the batch, transforms it into finished products, and preserves complete batch genealogy.

A distributor receives the finished product and records its movement.

The manufacturer publishes a digital product passport with a QR code.

A retailer or consumer scans the QR code and can independently inspect the permitted product history, origin information and verifiable attestations.

An enterprise buyer can use the Casitrace API to verify the relevant product and supply-chain information.

All these operations happen through one interoperable trust infrastructure.

**That is the Casitrace product vision.**

---

**Project delivery philosophy:** Build the foundation correctly, implement complete business workflows incrementally, verify every phase, and introduce advanced intelligence only after the underlying data and operational processes are reliable.
