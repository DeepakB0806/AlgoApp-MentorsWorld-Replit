---
name: sop-bop
description: Standard Operating Process for Broker Onboarding (SOP-BOP). Follow this 8-step process every time a new broker is added to the platform. Ensures zero-gap field mapping before Translation Layer build.
---

# SOP-BOP: Broker Onboarding Process

## Core Principle
**Broker is the boss.** Every field the broker API exposes must be fully analyzed, mapped, and accounted for. The platform orients to the broker's structure — not the other way around. Zero tolerance for unmapped fields before building the Translation Layer.

## The 8-Step Process

### Step 1: Broker SDK Adding
- Add broker API client module to `server/` (e.g., `server/kotak-neo-api.ts`)
- Implement authentication flow (login, session management)
- Implement core API calls (place order, modify, cancel, get positions/orders/holdings)
- Test connectivity with broker sandbox/production
- **Output**: Working SDK file with all broker endpoints callable

### Step 2: API Field Analysis
- Document every field from every broker API endpoint
- Add fields to the `ApiFieldsReference` component in `broker-api.tsx`
- Organize by category: Authentication, Order Placement, Order Modify, Order Cancel, Positions, Holdings, Orders, Margin, Limits, Quotes, Order History
- Each field documented with: field code, data type, description
- **Output**: Complete field reference visible in the Broker & Exchange API page

### Step 3: API Field Databasing → Universal Layer Mapping
- Click "Map to Universal Layer" button in the API Fields Reference
- Engine seeds all fields into `broker_field_mappings` database table
- Auto-maps broker fields to Universal Layer field names (e.g., `ts → tradingSymbol`)
- Review auto-mappings, fix any incorrect matches
- **Output**: All fields in database with `universalFieldName` populated

### Step 4: Dashboard Orientation
- Orient the Dashboard tables (Positions, Holdings, Orders) to display ALL fields the broker provides
- If broker sends 13 position fields, Dashboard shows all 13 — no hidden fields
- Credential fields map to their storage source (e.g., `broker_configs.mobileNumber`)
- Internal fields map to their system role (e.g., `order_params.validity`)
- **Output**: Dashboard displays every broker-provided field

### Step 5: Verify Field Matching (Checklist Method)
- Go through every field in the API Fields Reference
- Verify each `universalFieldName` mapping is correct
- Verify each field appears in the appropriate Dashboard table
- Mark verified fields as "matched" in the database
- **Output**: All fields show green "Matched" status

### Step 6: Identify Gaps
- Fields with no Universal Layer mapping → red "Gap" status
- Fields missing from Dashboard display → flagged
- Critical gaps (e.g., tradingSymbol format, lot size multiplication, product code mapping)
- Document each gap with severity (critical/major/minor)
- **Output**: Gap report with zero gaps remaining

### Step 7: Mitigate Gaps
- Resolve every gap identified in Step 6
- Add missing Universal Layer mappings
- Add transformation logic for complex fields (e.g., building trading symbol format)
- Add validation rules for field values
- **Output**: Zero gaps, all fields fully mapped and validated

### Step 8: Build Translation Layer (TL_{BrokerName})
- Only proceed when Steps 1-7 are certified complete
- Create `server/tl-{broker-name}.ts` (e.g., `server/tl-kotak-neo-v3.ts`)
- Translation Layer reads from `broker_field_mappings` database
- Converts Universal Layer field values to broker-specific format
- Converts broker responses back to Universal Layer format
- **Output**: Working Translation Layer that routes through the certified field mappings

## Naming Conventions
- SDK file: `server/{broker-name}-api.ts` (e.g., `server/kotak-neo-api.ts`)
- Translation Layer: `TL_{BrokerName}` (e.g., `TL_KotakNeoV3`)
- TL file: `server/tl-{broker-name}.ts`
- Broker name in database: lowercase with underscores (e.g., `kotak_neo_v3`)

## Database Reference
- Table: `broker_field_mappings` in PostgreSQL
- Key columns: `broker_name`, `category`, `field_code`, `universal_field_name`, `match_status`
- Each broker gets its own set of rows identified by `broker_name`
- The Translation Layer reads this table at runtime to translate fields

## Certification Criteria
Before building the Translation Layer (Step 8), ALL of the following must be true:
1. Every broker API field is in the `broker_field_mappings` database
2. Every field has a `universalFieldName` (or explicit "not_applicable" status with reason in notes)
3. Every response field is displayed in the appropriate Dashboard table
4. Zero fields with "gap" or "pending" status
5. All field transformations documented (e.g., symbol format, lot size, product code)

## Broker Onboarding Status Tracker

| Broker | DB Name | Current Step | Fields | Mapped | Gaps | TL Status |
|--------|---------|-------------|--------|--------|------|-----------|
| Kotak Neo V3 | kotak_neo_v3 | Step 4 (Dashboard Orientation) | 79 | 79/79 | 0 | Not started |

## Why This Process Matters
Without certified field mappings, the Translation Layer cannot build correct API payloads. Trades may appear to execute but will be void — wrong symbol format, wrong quantity (missing lot size multiplication), wrong product code. SOP-BOP ensures every field is accounted for before a single live trade is placed.
