# Jersey City Benefits Outreach — MVP Implementation PRD

**Status:** MVP implementation specification — real-data launch subject to acceptance tests
**Product:** Mobile-friendly internal web application
**Primary users:** Outreach volunteers and administrators
**Pilot scale:** Approximately 10 concurrent volunteers; 938 target households
**Supported field platforms:** iPhone Safari and Android Chrome
**Campaign timezone:** America/New_York

---

# 1. TL;DR

We are building a small mobile-friendly web application for non-electoral benefits outreach in Jersey City, New Jersey.

Volunteers will visit assigned households and provide information about existing New Jersey property-tax relief programs:

* Senior Freeze
* Stay NJ
* ANCHOR

The application is not an eligibility tool, application-processing system, political canvassing system, or resident CRM.

The MVP must allow an administrator to:

1. Import one approved CSV containing only permitted Tier 1 and Tier 2 outreach records.
2. Validate the import and household grouping.
3. Create a campaign and field events.
4. Create building-run or manually ordered household assignments.
5. Issue private assignment links to volunteers.
6. Review synchronized field results.
7. Review basic resident-reported corrections.
8. Manage basic application-help requests.
9. Enforce campaign-level do-not-contact suppression.
10. Enforce campaign expiration and deletion.

The MVP must allow a volunteer to:

1. Open a private assignment link.
2. Download their assignment and program reference material.
3. Confirm the assignment is stored for offline use.
4. Work through buildings and households without connectivity.
5. Record visits, application-help requests, corrections, and do-not-contact requests.
6. Close and reopen the browser without losing saved work.
7. Synchronize later without creating duplicate records.
8. Clearly understand whether work is only on the device or has been received by the server.

The most important end-to-end flow is:

> Approved CSV → validated household → assignment → private volunteer link → offline visit → browser close/reopen → visit survives → reconnect → synchronize → administrator sees the correct result.

A rough interface is acceptable.

Lost visits, exposed assignments, duplicate uploads, falsely counted doors, or deletion that never executes are not.

---

# 2. How to Use This PRD

Implementation may begin immediately using synthetic data.

Real resident data may only be used after the launch-gate requirements in this document pass.

When scope tradeoffs are necessary, preserve these capabilities before visual polish or administrative convenience:

1. Data-boundary enforcement
2. Household grouping
3. Authorization
4. Offline durability
5. Atomic save behavior
6. Synchronization integrity
7. Accurate field-result semantics
8. Campaign deletion

Build order does not change launch requirements.

A capability implemented late may still be mandatory before the pilot begins.

---

# 3. Product Purpose

The purpose of this product is to help volunteers conduct informational outreach about existing New Jersey property-tax relief programs.

The outreach list identifies likely senior owner-occupants for outreach purposes.

It does not establish program eligibility.

The product must support multiple programs rather than treating Senior Freeze as the only program.

Program information must exist separately from campaign and event data.

Each program record must identify:

* program name;
* resident-facing summary;
* official source;
* source URL;
* last-reviewed date;
* active/inactive status.

Program eligibility thresholds, filing rules, or other program details must not be invented or hardcoded without an approved source.

---

# 4. Product Boundaries

The application must never:

* return a “not eligible” result;
* determine eligibility;
* infer eligibility or ineligibility from age;
* infer eligibility or ineligibility from ownership information;
* infer eligibility or ineligibility because someone reports renting;
* imply that inclusion in the outreach list means eligibility;
* collect a benefits application;
* collect financial documents;
* collect eligibility evidence;
* retrieve phone numbers from the original voter file;
* retrieve email addresses from the original voter file;
* retrieve party information;
* retrieve voting history;
* retrieve race, religion, ideology, or similar enrichment;
* import Tier 3 data;
* import or join the renter-likely exclusion file;
* create a permanent identifying resident database across campaigns.

The product supports outreach.

It does not decide who qualifies for benefits.

---

# 5. Problem Statement

Volunteers need a fast, reliable way to work through assigned Jersey City households and record what actually happened at each door, even in buildings or neighborhoods with weak cellular connectivity.

The approved source file is person-based, while field work is household-based.

A couple living in one unit should create one door assignment, not two.

The outreach source also contains information that volunteers do not need. Merely hiding that information in the volunteer interface is insufficient; unnecessary fields should not be delivered to volunteer devices at all.

The administrator therefore needs a system that can transform an approved outreach list into a controlled household-level workflow while preserving:

* accurate grouping;
* minimal data exposure;
* reliable offline operation;
* trustworthy visit history;
* safe follow-up capture;
* explicit retention limits.

---

# 6. Intended Outcome

A volunteer should be able to receive a small set of doors and complete the assignment confidently from their own phone without:

* creating an account;
* needing a map;
* requiring continuous internet access;
* interpreting a large source spreadsheet;
* making eligibility judgments.

An administrator should be able to reliably answer:

* Which households were actually attempted?
* Which households produced conversations?
* Which buildings were inaccessible?
* Which households received repeat visits?
* Who requested application help?
* Which corrections were reported?
* Which assignments have successfully synchronized?
* Which campaign records are approaching deletion?

---

# 7. Narrative

A volunteer receives a private assignment link before beginning a building run.

They open it on their phone.

The application shows:

**18 households — 1 building**

They tap:

**Download assignment**

The application stores:

* the assigned building;
* household and unit information;
* resident names;
* current program reference material.

After durable local storage succeeds, the application shows:

**Ready offline**

The volunteer enters the apartment building and loses cellular connectivity.

They open Unit 2A.

Two listed residents live in that household.

Both names appear underneath one household record.

The volunteer is not sent to Unit 2A twice.

Nobody answers.

The volunteer selects:

**No answer**

and taps:

**Save & next**

The application commits the visit locally before navigating away.

The screen shows:

**Saved on this device**

At Unit 3B, the volunteer speaks with a resident who asks for help with the application process.

The volunteer records:

**Spoke with resident**

and:

**Wants application help**

The resident does not provide a phone number.

The help request still saves.

At another unit, a resident reports that one listed person moved away.

That report becomes a Correction Report associated with that person.

It does not silently rewrite the imported record.

The volunteer closes Safari between floors.

When they reopen the application, all saved visits are still present.

When they leave the building and connectivity returns, they tap:

**Sync now**

The application uploads the locally saved operations.

If an upload was actually committed by the server but the phone lost the acknowledgment, retrying does not create another visit.

The administrator later sees:

* 14 unique households attempted;
* 7 conversations;
* 1 application-help request;
* 1 resident-reported correction.

At the next building, the front door is locked.

The volunteer records:

**Cannot access building → Locked lobby**

The product records one building-access failure.

It does not create 12 fictitious “No answer” household visits.

Thirty days after the campaign ends, identifying campaign data reaches its deletion timestamp.

An unresolved help request does not silently keep the campaign database alive forever.

---

# 8. Users

## 8.1 Volunteer

Approximately 10 concurrent volunteers.

Volunteers:

* use personal phones;
* do not create accounts;
* do not use passwords;
* receive organizer-issued private assignment links;
* see only their assigned household information and necessary reference material.

Possession of the private assignment link grants access.

This limitation must be explained to organizers and volunteers.

---

## 8.2 Administrator

Administrators include:

* the website owner;
* specifically approved senior-team administrators.

Administrators can manage permitted campaign records including:

* imports;
* household validation;
* campaigns;
* events;
* assignments;
* visit results;
* correction reports;
* help requests;
* retention status.

Administrator access never includes prohibited datasets because those datasets must not exist in the application.

---

# 9. Required Scope Before Field Pilot

The following functionality is required before the application is used with real resident data.

## Data

* Approved CSV import
* Exact schema validation
* Explicit persistence allowlist
* Tier 1 and Tier 2 only
* Tier 3 rejection
* Household grouping
* Household-grouping validation
* Duplicate-import protection

## Access

* Administrator authentication
* Administrator allowlist
* Private volunteer assignment links
* Assignment-link expiration
* Link revocation
* Server-side authorization on every relevant request

## Assignments

* Building runs
* Manually ordered scattered-door assignments
* Prevention of overlapping active household assignment within one event
* Basic reassignment/supersession behavior

## Volunteer field workflow

* Assignment download
* Offline-readiness confirmation
* Building → Household → People navigation
* Visit recording
* Building-access recording
* Application-help request
* Basic correction report
* Do-not-contact request
* Durable local save
* Browser close/reopen recovery
* Manual synchronization
* Visible sync state
* Safe retry

## Administration

* Basic campaign creation
* Event creation
* Assignment creation
* Private-link issuance/revocation
* Basic synchronized-results view
* Basic Correction Report review list
* Basic Help Request states
* Last server contact/sync information
* Campaign end date
* Scheduled deletion date
* Working deletion process

---

# 10. Deferred Scope

The following capabilities are explicitly deferred.

* Maps
* Geocoding
* Automatic routing
* Route optimization
* Volunteer location tracking
* Native mobile application
* Interactive household-grouping editor
* Advanced analytics
* Advanced reporting
* Export-management UI
* Automated conflict resolution
* Sophisticated correction management
* Complex follow-up workflow
* Notifications
* Task reminders
* Program-content editing UI
* Volunteer self-claiming
* Volunteer self-reassignment
* Permanent cross-campaign suppression
* Historical resident profiles
* Tier 3 deed-research workflows

Program content may initially be maintained through a simple seeded configuration rather than a full administrator editor.

---

# 11. Data Source

The approved outreach dataset currently contains:

* 1,157 people
* 938 household units
* 605 buildings

Household counts:

* 725 households with one listed senior
* 207 households with two listed seniors
* 6 households with three listed seniors

Ward counts:

* Ward A: 383 households
* Ward B: 78
* Ward C: 186
* Ward D: 71
* Ward E: 132
* Ward F: 88

Each spreadsheet row represents a person.

The source headers are:

* VANID
* Last Name
* First Name
* Age
* Residence Address
* Zip
* Ward
* Block
* Lot
* Qual
* Property Location
* Unit (verified)
* Owner of Record
* Matched Owner Name
* Tier
* Tier Label
* Match Rationale
* Persons in Household
* Household Key
* Other Parcels Matched
* Score

---

# 12. Import Contract

The first production version accepts:

**UTF-8 CSV exported from the approved spreadsheet.**

Native Excel workbook import is deferred.

The website owner is responsible for selecting the approved source artifact.

Matching the expected schema alone does not prove that a file is an approved dataset.

---

# 13. Import Schema Rules

The importer recognizes the documented source schema.

Unknown headers cause file rejection.

Recognized source columns that are not on the persistence allowlist are discarded before persistence.

The application must never depend on frontend hiding as a method of data minimization.

---

# 14. Persisted Import Fields

Persist only the source fields required for the application.

Required persistence allowlist:

* VANID or approved source identifier
* First Name
* Last Name
* Residence Address
* Zip
* Ward
* Block
* Lot
* Qual
* Property Location
* Unit (verified)
* Tier
* Household Key

Plus application-generated:

* internal IDs;
* import identifiers;
* timestamps;
* normalized grouping references.

Treat the following values as text rather than numeric values where applicable:

* VANID
* ZIP
* Block
* Lot
* Qual
* unit identifiers

This preserves leading zeros and avoids numeric coercion.

---

# 15. Recognized but Non-Persisted Fields

Unless separately approved, discard:

* Age
* Owner of Record
* Matched Owner Name
* Tier Label
* Match Rationale
* Persons in Household
* Other Parcels Matched
* Score

`Persons in Household` should be calculated from the validated import rather than treated as authoritative.

These discarded values must not appear in:

* application database records;
* volunteer payloads;
* validation logs;
* retained upload files.

---

# 16. Tier Validation

Only Tier 1 and Tier 2 are permitted.

If any row contains:

* Tier 3;
* a blank Tier;
* an unknown Tier;
* a malformed Tier;
* any value other than explicitly permitted Tier 1 or Tier 2;

the entire import is rejected.

No rows from that import attempt are committed.

Example:

> Import rejected. 14 records contain a disallowed or invalid Tier value. No campaign records were imported. Correct the source file and retry.

Do not list unnecessary resident information in error messages.

---

# 17. Prohibited Data

## Tier 3

Tier 3 contains:

* 151 people;
* 131 parcels;
* trust-owned parcels;
* ambiguous units requiring deed research.

Tier 3 is completely outside this MVP.

It must not appear in:

* import persistence;
* administrator views;
* volunteer assignments;
* logs;
* retained raw uploads.

---

## Renter-likely exclusion file

The renter-likely exclusion file contains approximately 595 people.

It must never be:

* imported;
* joined;
* enriched;
* stored;
* added to the administrator dashboard.

Its audit purpose is outside this product.

---

## Original voter-file enrichment

Do not retrieve or rejoin the original voter file to obtain:

* phone numbers;
* emails;
* party;
* voting history;
* race;
* religion;
* ideology;
* other enrichment.

---

# 18. Raw Upload Handling

Raw production uploads must not become a second resident database.

Required behavior:

* do not intentionally store source CSVs in permanent object storage;
* do not make original uploads downloadable after import;
* do not log spreadsheet rows;
* do not log unnecessary resident names or addresses;
* remove temporary processing files after validation/import;
* verify whether the hosting platform retains HTTP request bodies or temporary uploads.

The hosting/import path must be reviewed before real-data use.

Example acceptable log:

> Import 123 rejected — invalid tier detected — count 14.

Unacceptable log:

> John Smith, 123 Main Street, Tier 3 rejected.

---

# 19. Reimporting

The MVP supports one finalized source import per Campaign.

Administrators may repeat validation and preview until they explicitly finalize an import.

Finalization commits the validated dataset atomically.

The MVP does not replace a finalized dataset.

An identical retry returns the existing import result; a different file submitted after finalization is rejected.

Submitting the same approved file twice must not duplicate:

* People;
* Households;
* Buildings.

If household grouping needs correction:

> Correct the approved source file and repeat validation before finalizing the import.

The MVP does not contain an interactive household-grouping editor.

---

# 20. Household Model

The field hierarchy is:

> Building → Household → People

A Household represents one outreach door/unit.

Two or three listed people in one validated household create one Household assignment.

They do not create separate doors.

---

# 21. Household Key Validation

The source `Household Key` is Block-Lot-Qual and is intended to identify a dwelling unit.

The product must not blindly trust it.

Import validation should flag:

* same Household Key with conflicting residence addresses;
* same Household Key with conflicting verified units;
* unexpected multi-unit grouping;
* missing Household Key;
* missing address;
* household person count inconsistent with imported rows;
* other clear grouping contradictions.

The MVP does not need to automatically resolve these.

Show:

> Household grouping issue detected. Correct the source file and retry.

---

# 22. Conceptual Data Model

## Campaign

The privacy and retention container.

Owns:

* imported permitted population;
* campaign do-not-contact suppression;
* campaign end date;
* deletion timestamp;
* Events;
* identifying campaign records.

---

## Event

A specific field-work operation inside a Campaign.

Example:

> Ward C Saturday Outreach

Every Event has:

* Event ID
* Campaign ID
* Name
* Start/end status
* Explicit end timestamp

An Event must end no later than its Campaign.

---

## Building

One physical address grouping.

Contains one or more Households.

---

## Household

One outreach door or unit.

Contains one or more People.

---

## Person

One imported listed resident.

Person-specific reports attach to the Person rather than automatically applying to every Household member.

---

## Program

Reusable, non-campaign-specific reference content.

Fields:

* Program ID
* Name
* Short description
* Official source
* Source URL
* Last reviewed date
* Active/inactive

---

## Assignment

Represents a volunteer work package.

Contains ordered Assignment-Household memberships.

Types:

* Building Run
* Scattered Doors

---

## Assignment-Household Membership

Connects a Household to an Assignment.

Has status so individual households may be superseded/reassigned without invalidating the entire Assignment.

---

## Assignment Credential / Link

Grants volunteer access to one Assignment according to the access lifecycle.

---

## Visit

Represents one household-level field interaction or attempt at a point in time.

Multiple Visits can exist for one Household.

Visits are not overwritten by later visits.

---

## Submission Operation

An immutable client-generated operation representing a saved field submission.

A Submission Operation may contain:

* one Visit;
* zero or more Correction Reports;
* zero or one Help Request;
* zero or one do-not-contact request.

All associated records are committed atomically.

---

## Visit Revision

Represents an edit to an already saved Visit.

A revision references:

* original Visit;
* original Submission Operation;
* its own unique operation ID.

A revision does not count as another door attempt.

---

## Building Access Attempt

Represents inability to access a building before reaching household doors.

It is not a Visit.

---

## Correction Report

Represents information reported in the field that requires administrator review.

Examples:

* Says they rent
* Person moved
* Person reported deceased
* Wrong address

It does not automatically overwrite source data.

---

## Help Request

Represents a resident's request for application assistance.

States:

> New → In progress → Resolved

---

# 23. Administrator Authentication

**Required before real resident data.**

Administrators can view the full permitted outreach dataset, so administrator access must be stronger than volunteer private links.

Recommended implementation:

* existing authentication provider;
* passwordless or equivalent acceptable authentication;
* explicit allowlist of administrator identities.

A secret administrator URL alone is not sufficient for production data.

Implementation dependency:

The website owner must provide the administrator allowlist before real-data launch.

---

# 24. Volunteer Access Model

Volunteers do not create accounts.

Each Assignment receives a private high-entropy credential.

The private URL should contain no resident information itself.

Possession of the URL grants access to the associated Assignment.

The product must communicate:

> This link gives access to your assigned household information. Do not forward it.

---

# 25. Assignment Access Lifecycle

Every Event has an explicit end timestamp.

## While Event is active

Assignment credential permits:

* authorized assignment download;
* program-content download;
* field-data upload;
* synchronization.

## After Event ends

For 72 hours after the Event end timestamp, subject to Campaign deletion:

Credential permits:

* upload of already-created pending work;
* synchronization acknowledgments.

Credential does not permit:

* downloading fresh resident data;
* accessing newly assigned households.

This is the **synchronization window**.

## Campaign deadline cap

The 72-hour synchronization window can never extend beyond the Campaign deletion timestamp.

---

# 26. Revocation

An administrator can revoke an Assignment credential.

Revocation immediately blocks future server access using that credential.

This includes:

* download;
* refresh;
* upload;
* synchronization.

The application should explain:

> This assignment link has been revoked. Pending work could not be submitted. Contact the organizer.

Revocation does not magically erase pending local records from a disconnected device.

Pending local data must not be silently deleted before the normal retention deadline.

Automated recovery of data created under a revoked credential is outside MVP scope.

---

# 27. Server Authorization

Every relevant server request must independently validate:

* credential;
* Campaign;
* Event;
* Assignment;
* Assignment-Household membership;
* requested action;
* applicable access state.

Client-supplied Household IDs or Assignment IDs must never establish authorization by themselves.

A volunteer credential requesting an unrelated Household must be rejected.

---

# 28. Assignment Types

## Building Run

Used for grouped Households within one Building.

Show:

* Building address;
* units in natural order;
* Household status.

Only infer floors where reliable data supports doing so.

Do not guess floor numbers from ambiguous unit text.

---

## Scattered Doors

An administrator-defined ordered list of Households.

The order is manual.

Use labels such as:

* Ordered list
* Suggested order

Do not call the list:

* optimized;
* route optimized;
* shortest route.

Automatic route optimization is deferred.

---

# 29. Assignment Rules

Organizer-assigned work only.

No volunteer self-claiming.

Within the same active Event, the server should prevent two active Assignment-Household memberships for the same Household unless explicitly superseded/reassigned.

---

# 30. Reassignment

Reassignment operates on Assignment-Household memberships.

It does not necessarily invalidate an entire Assignment.

Example:

Alice downloaded Households 1–20.

Organizer moves Households 11–20 to Bob.

The server marks Alice's memberships for 11–20 as:

**Superseded**

and creates active memberships for Bob.

Previously downloaded copies may still exist on Alice's phone.

Existing legitimate Visits recorded before or during the reassignment condition are preserved.

Previously downloaded assignments may continue uploading valid pending work during the credential's authorized synchronization window unless the credential has been explicitly revoked.

Admin UI should identify submissions that came from superseded assignment memberships.

Do not discard a genuine resident interaction solely because reassignment occurred while the phone was offline.

---

# 31. Volunteer Screen 1 — Private Assignment Link

Display:

**Event name**

Assignment summary:

> 18 households
> 1 building

Primary action:

**Download assignment**

Supporting copy:

> This private link gives access to your assigned household information. Do not forward it.

If invalid or expired:

> This assignment link is no longer available. Contact your organizer.

If upload-only:

> Field work has ended. You can sync previously saved work, but cannot download new household information.

---

# 32. Volunteer Screen 2 — Download and Offline Readiness

After download, verify local persistence.

Display:

> ✓ Assignment stored
> ✓ Program information stored
> ✓ Offline storage ready

Then:

**Ready offline**

And:

> 18 households available on this device

If durable local storage fails:

> Offline storage could not be confirmed. Do not begin the assignment.

Action:

**Retry**

Do not display Ready Offline merely because a network request succeeded.

---

# 33. Volunteer Screen 3 — Assignment Overview

For a Building Run:

**120 Example Avenue**

Progress:

> 4 of 18 households recorded

Household/unit rows:

* Unit 2A — Not visited
* Unit 2B — Saved on device
* Unit 3A — Received
* Unit 3B — Not visited

Address and unit should be visually prominent.

People appear beneath the Household rather than as separate assignment rows.

For Scattered Doors, display ordered addresses instead.

---

# 34. Volunteer Screen 4 — Household

Header:

**Unit 3B**

Building address beneath.

Then:

**Listed residents**

Maria Rivera
Luis Rivera

Primary action:

**Record visit**

Secondary action:

**Program information**

If there is existing synchronized visit history available, show it compactly.

---

# 35. Volunteer Screen 5 — Record Visit

First question:

## What happened?

Use large tap targets.

Exactly one contact result:

* Spoke with resident
* Spoke with someone else
* No answer
* Inaccessible
* Declined conversation

No preselected outcome.

No long dropdown.

No required free-text note.

---

# 36. Conversation Details

Where relevant, offer:

## Information delivered

Select zero or more:

* Senior Freeze
* Stay NJ
* ANCHOR

## Application help

Toggle:

**Wants application help**

## Already applied / already receiving

Optional resident-reported detail.

Select:

* Senior Freeze
* Stay NJ
* ANCHOR
* Unsure

This is a resident-reported statement.

It is not an eligibility determination.

---

# 37. Resident-Reported Corrections

Separate section:

**Did the resident report anything we should review?**

Options:

* Says they rent
* Person moved
* Person reported deceased
* Wrong address
* Explicit do-not-contact request

If the report concerns one Person, require the volunteer to select the applicable Person.

Do not automatically attach a Person-specific report to all Household members.

---

# 38. Declined vs Do Not Contact

These are different.

**Declined conversation**

means:

> The resident did not wish to engage during this visit.

It does not suppress future outreach.

**Explicit do-not-contact request**

means:

> The resident requested no further campaign outreach to this Household.

It triggers Campaign-level suppression.

---

# 39. Do-Not-Contact Behavior

When a do-not-contact request is saved:

## On recording device

Immediately suppress further outreach to the Household in the current local Assignment.

The Household should visibly show:

**Do not contact**

The volunteer should not be prompted to revisit it.

## After server synchronization

The server marks the Household suppressed across the Campaign.

Future Assignment creation excludes the Household.

Existing assignments should receive suppression when they next refresh.

## Offline limitation

A disconnected device cannot immediately learn about a do-not-contact request recorded on another device.

If an independent offline Visit already occurred, it remains uploadable under the normal authorization rules.

## History

Suppression does not erase earlier Visits.

## Correction of accidental suppression

Ordinary Visit editing must not silently clear suppression.

An administrator may remove an accidental suppression with:

* recorded action;
* reason.

Campaign suppression expires with Campaign identifying data.

---

# 40. Save & Next — Atomic Local Save

Unsaved drafts may be edited freely.

Tapping:

**Save & next**

creates an immutable Submission Operation with a unique client-generated operation ID.

The operation contains the complete saved action, including where applicable:

* Visit;
* Help Request;
* Correction Reports;
* do-not-contact request.

These records must be committed together in one local transaction.

Either:

* the whole operation is durably saved;

or:

* none of it is considered saved.

Only after the local transaction succeeds may the UI show:

**Saved on this device**

and navigate to the next Household.

---

# 41. Editing Saved Visits

Once **Save & next** succeeds, the saved operation is immutable.

Editing a saved Visit creates a new **Revision Operation**.

The revision:

* receives its own operation ID;
* references the original Visit;
* preserves original history;
* updates the effective result shown to administrators.

This applies whether or not the device has received server acknowledgment.

A Visit Revision does not increment:

* unique household attempts;
* repeat visits;
* conversations as a separate visit.

It modifies the interpreted result while preserving history.

Associated Help Requests and Correction Reports have stable identifiers.

Visit revisions must not duplicate them or reset administrator-managed status.

Changes to their content retain history.

A request withdrawal is surfaced for administrator review and does not silently delete the request.

Do-not-contact removal continues to require the administrator action defined in Section 39.

The exact transaction and revision-precedence rules belong in the architecture document.

---

# 42. Why Revisions Are Required

The following failure must be handled safely:

1. Phone uploads Visit A.
2. Server commits Visit A.
3. Network fails before acknowledgment reaches phone.
4. Volunteer edits Visit A.
5. Phone later retries.

The system must not:

* create duplicate Visit A;
* overwrite history unpredictably;
* interpret the edited Visit as a separate door attempt.

Immutable operations plus revisions resolve this ambiguity.

---

# 43. Building Access Flow

A building-level access failure is not a Household Visit.

From a Building Run, provide:

**Cannot access building**

Then:

* Locked lobby / entrance
* Doorman or security denied access
* Unable to locate entrance
* Other

Saving creates one:

**Building Access Attempt**

Then ask:

**End this building run for now?**

If yes:

* remaining Households stay **Not visited**;
* no automatic household Visits are created;
* no household is counted as attempted.

---

# 44. Offline Requirement

Once an Assignment is successfully downloaded and marked Ready Offline, the volunteer must be able to:

* lose network connectivity;
* load their Assignment;
* view Buildings;
* view Households;
* view People;
* view Program reference content;
* create Visits;
* create Correction Reports;
* create Help Requests;
* create do-not-contact requests;
* create Building Access Attempts;
* close the browser;
* reopen the application;
* recover previously saved unsynchronized operations.

Core field work must not depend on an online map.

---

# 45. Local Storage

Use browser storage suitable for durable structured offline data.

Do not rely only on:

* page memory;
* React/application state;
* session state;
* URL state;
* HTTP cache.

The exact technical implementation belongs to engineering, but the product requirement is durable recovery across browser close/reopen.

---

# 46. Honest Offline Messaging

“Ready offline” means:

> Required Assignment data and reference material were successfully persisted locally on this device.

It does not mean browser storage can never be lost.

Volunteer guidance should state:

> Your assignment is ready offline. Clearing browser or site data may remove unsynchronized work. Sync when connectivity returns.

Do not claim that synchronization occurs while the browser is closed.

---

# 47. Client Sync States

Keep visible states simple.

## Draft

Not yet saved.

## Saved on device

Durably stored locally and not currently uploading.

## Uploading

Upload request in progress.

## Received

Server has committed and acknowledged the operation.

If upload is interrupted:

**Uploading → Saved on device**

Show:

> Upload interrupted. Your work is still saved on this device.

Action:

**Retry**

Permanent rejection reasons are displayed separately rather than modeled as endless retry states.

---

# 48. Atomic Server Synchronization

Each Submission Operation is processed atomically on the server.

Either:

* the Visit and every associated record commit;

or:

* none commit.

The server acknowledges an operation only after the transaction completes.

Example:

A Visit contains:

* Spoke with resident
* Wants application help
* Person moved Correction Report

If Help Request creation fails server-side:

The server must not acknowledge the Visit as fully received.

---

# 49. Idempotency

Every Submission Operation has a unique client-generated operation ID.

If the same operation ID is uploaded again with identical content:

> Return the original successful acknowledgment.

Do not create duplicate:

* Visits;
* Help Requests;
* Correction Reports;
* suppression requests;
* Building Access Attempts.

If the same operation ID is reused with different content:

> Return an explicit conflict error.

Do not silently replace the existing operation.

---

# 50. Independent Visits

Different genuine Visits receive different Visit IDs and operation IDs.

If Volunteer A and Volunteer B independently record legitimate Visits against the same Household:

Both Visits survive.

The system does not perform last-write-wins replacement at the Household level.

A Household must not have one mutable “current visit result” field that destroys history.

---

# 51. Revision Ordering

Revision Operations reference an original Visit.

The client uploads dependent operations in order.

Example:

1. Visit operation
2. Revision operation

The revision should not be treated as successfully synchronized before the original Visit exists server-side.

Unacknowledged operations remain stored locally until acknowledged or the Campaign deletion deadline arrives. A permanent rejection stops automatic retries and displays the reason; it does not itself delete the operation. Campaign expiration triggers the defined cleanup behavior.

---

# 52. Retryable vs Permanent Sync Errors

## Retryable

Examples:

* connection lost;
* server temporarily unavailable;
* timeout.

Behavior:

> Saved on device — retry available

The application may retry automatically while open and must also provide manual retry.

## Permanent

Examples:

* credential revoked;
* Campaign expired;
* invalid operation content;
* unauthorized Household.

Behavior:

Display the reason.

Do not retry forever.

Example:

> This assignment was revoked. Your pending work could not be submitted. Contact the organizer.

---

# 53. Application Help Request

Selecting:

**Wants application help**

creates a Help Request as part of the Submission Operation.

Required:

* Household;
* originating Visit;
* requesting Person when known;
* initial state: New.

Optional:

* resident-provided phone number;
* permission to use that phone number for application-help follow-up;
* brief note;
* return-visit arrangement;
* referral arrangement.

The resident does not need to provide a phone number.

---

# 54. Phone Number Rules

Phone numbers:

* are optional;
* may only be entered if provided by the resident;
* are never retrieved from the original voter file;
* must not be required to create a Help Request.

A phone number may be persisted only when permission for application-help follow-up is recorded.

If permission is absent, the interface offers to remove the number and save the Help Request without it.

Missing permission must never prevent saving the underlying request for help without contact details.

Recommended UI:

**Phone number — optional**

Then:

**Resident gave permission to use this number specifically for application-help follow-up**

If no phone is provided, offer:

* Return visit needed
* Resident will contact referral
* Other arrangement

Do not collect:

* financial documents;
* benefit applications;
* proof of eligibility.

---

# 55. Help Request States

Simple lifecycle:

> New → In progress → Resolved

Task ownership may be included as a simple optional owner field if more than one administrator will perform follow-up.

Do not add for MVP:

* reminders;
* automated notifications;
* complex tagging;
* workflow automation;
* SLA logic.

---

# 56. Administrator Screen — Campaigns

Display:

* Campaign name
* Status
* Campaign end date
* Exact deletion timestamp

Actions:

**Create campaign**

**Open campaign**

Example:

> Campaign ends: October 12, 2026 at 11:59 PM ET
> Identifying data scheduled for deletion: November 11, 2026 at 11:59 PM ET

---

# 57. Administrator Screen — Import

Administrator selects the approved CSV.

Display:

**Checking file…**

Then one of:

## Valid

> 1,157 people
> 938 households
> 605 buildings
> 0 blocking errors

Action:

**Continue**

## Rejected

> Import rejected
> 14 invalid or prohibited Tier records detected
> No records were imported

Action:

**Correct source file and retry**

---

# 58. Administrator Screen — Household Validation

Display grouping anomalies.

Example:

> 926 household groups valid
> 12 household groups require correction

Example issue:

**Household Key 123-45-6**

Maria Rivera — Unit 2A
Luis Rivera — Unit 3A

Message:

> Conflicting verified units were found for the same Household Key. Correct the source file and retry the import.

The MVP does not provide an in-app grouping editor.

---

# 59. Administrator Screen — Event

Create Event.

Required:

* Campaign
* Event name
* end timestamp

Event end must not be later than Campaign end.

---

# 60. Administrator Screen — Assignment Builder

Choose:

**Building run**

or:

**Scattered doors**

For Building Run:

* select Building;
* display Households in natural unit order.

For Scattered Doors:

* select Households;
* manually reorder.

Action:

**Create assignment**

Then:

**Generate volunteer link**

---

# 61. Administrator Screen — Assignment Management

Display:

* Assignment name/label
* optional volunteer label
* Household count
* credential state
* Event end
* upload window end
* last server contact
* last device-reported pending count
* latest confirmed synchronization time

Actions:

* Copy private link
* Revoke
* Reissue
* Supersede Household assignment
* View results

Complex drag-and-drop reassignment management is deferred.

---

# 62. Administrator Sync Information

Administrators cannot know the current state of a disconnected phone.

Therefore the administrator UI may show:

* last server contact;
* last device-reported pending count;
* latest confirmed synchronization;
* last received completion marker.

These values represent the last information the server received.

They do not prove that a disconnected phone has no unsaved work.

---

# 63. Volunteer Completion

A volunteer may mark:

**Field work finished**

locally.

The administrator only sees:

**Finished and synchronized**

after the server receives:

* the completion marker;
* all operations the device declared pending at that completion point.

If additional work is recorded after completion:

The device's completion state becomes invalid until synchronized again.

---

# 64. Administrator Screen — Results

Primary metrics:

* Unique households attempted
* Conversations
* Repeat visits
* Building-access failures
* Application-help requests

Also show:

> Latest confirmed synchronization: [time]

Do not imply unsynchronized device activity is visible.

---

# 65. Reporting Definitions

## Qualifying Household Attempt

A Visit with a household-level contact result recorded through the normal Visit workflow.

Building Access Attempts do not qualify.

Visit Revisions do not create additional attempts.

---

## Unique households attempted

Count distinct Household IDs with at least one qualifying Visit.

---

## Repeat visits

Total qualifying Visits minus unique households attempted.

---

## Conversations

Qualifying Visits where contact result is:

* Spoke with resident
* Spoke with someone else

---

## Building-access failures

Count Building Access Attempts with a blocked-access result.

These do not increment household attempts.

---

## Application-help requests

Count distinct Help Requests created.

Visit Revisions do not create duplicate Help Requests unless a genuinely separate request is intentionally recorded.

---

# 66. Administrator Screen — Correction Review

MVP needs only a simple review queue.

Show:

* Person or Household
* address/unit
* reported issue
* originating Visit
* time received
* review status

Example:

> Maria Rivera
> 120 Example Ave, Unit 3B
> Report: Person moved

Basic actions:

* Mark reviewed
* Keep open

Automated conflict detection and sophisticated reconciliation are deferred.

---

# 67. Administrator Screen — Help Requests

Display:

* requesting Person, where known;
* Household;
* optional phone;
* contact permission;
* status;
* optional owner;
* originating Visit.

Actions:

* Mark In progress
* Resolve
* Assign owner, if enabled

---

# 68. Program Content

Program content remains separate from Campaign/Event data.

Initial program content can be supplied through seeded configuration.

Each Program includes:

* Program name
* Resident-facing summary
* Official source name
* Source URL
* Last reviewed date
* Active/inactive status

Volunteer reference material is downloaded with the Assignment.

No program-content administrator editor is required for MVP.

---

# 69. Retention Policy

Every Campaign has:

* explicit end timestamp;
* exact deletion timestamp.

Deletion timestamp is:

> 30 calendar days after Campaign end

using America/New_York time.

The exact timestamp must be visible to administrators.

---

# 70. Identifying Data Subject to Deletion

Campaign deletion covers application-controlled copies of:

* imported People;
* identifying Household records;
* identifying Building records where tied to the Campaign;
* Assignments;
* Assignment credentials;
* Visits;
* Visit Revisions;
* Building Access Attempts;
* Correction Reports;
* Help Requests;
* resident-provided phone numbers;
* identifying notes;
* Campaign do-not-contact suppression.

Unresolved Help Requests do not silently extend the deadline.

---

# 71. Scheduled Deletion

A functioning scheduled deletion process is required before real-data launch.

At the Campaign deletion timestamp:

1. The Campaign becomes unavailable for identifying access.
2. New identifying downloads are rejected.
3. Delayed identifying uploads are rejected.
4. Identifying Campaign records are deleted according to the approved implementation.
5. Old devices cannot recreate deleted Campaign records.

Deletion failures must be visible to administrators.

Example:

> Campaign deletion failed — administrator action required

A retention policy that exists only in documentation is insufficient.

---

# 72. Device Expiration

When an Assignment is downloaded, the device also receives the Campaign deletion timestamp.

The application checks expiration:

* on launch;
* on resume;
* before displaying Campaign data;
* before creating new field records.

If the Campaign is expired:

Remove locally stored Campaign identifying information when the application next runs.

This should work even if the device is offline by comparing against the stored deletion timestamp.

---

# 73. Offline Cleanup Limitation

Offline cleanup is best effort.

The application cannot:

* execute while the browser/device never opens;
* remotely erase data from a disconnected phone;
* guarantee deletion if a user deliberately manipulates the device clock or browser storage behavior.

The product must state this limitation honestly.

---

# 74. Open Tasks at Expiration

Open Help Requests do not automatically extend Campaign retention.

Administrators should receive prominent warnings before deletion.

Example:

> 4 unresolved application-help requests remain. Identifying Campaign data is still scheduled for deletion on November 11.

At expiration, the approved retention policy wins.

A new retention policy would require a separate product/policy decision.

---

# 75. Backups

Before production launch, engineering must identify whether infrastructure backups retain deleted campaign data.

If yes:

* document backup retention duration;
* ensure backups age out on the infrastructure schedule;
* ensure restoring an old backup does not unintentionally make expired Campaign data accessible again.

Expired data must not silently become live through routine restoration.

---

# 76. External Exports

A dedicated exports UI is deferred.

If administrators manually create/download exports through any available mechanism:

The application cannot automatically delete those external copies.

Any export surface must state:

> This file contains Campaign data subject to the Campaign retention policy. External copies must be deleted separately by the administrator.

Exports do not extend application retention.

---

# 77. Reusable Data

The following may remain after Campaign deletion because they are non-identifying or reusable:

* Program content
* Program source links
* Program review dates
* Event templates without resident data
* non-identifying aggregate totals

Future Campaigns import a fresh approved outreach list.

---

# 78. Success Metrics

Pilot success prioritizes correctness and reliability over volume.

## Offline durability

**Target: 100% in launch testing**

Every locally saved test operation survives browser close/reopen.

---

## Synchronization integrity

**Target: 100% in launch testing**

Each test Submission Operation appears server-side exactly once after successful synchronization.

---

## Associated-record integrity

**Target: 100%**

If a Submission contains a Help Request, Correction Report, or suppression request, the server either commits the entire Submission or acknowledges none of it.

---

## Household integrity

**Target: 100%**

A validated couple or multi-person Household produces one door assignment.

---

## Authorization integrity

**Target: 100%**

A volunteer credential cannot retrieve or submit against unrelated Households.

---

## Prohibited-data protection

**Target: 100%**

Tier 3 test data creates zero persistent records.

Volunteer payloads contain none of the prohibited/minimized server fields.

---

## Building-access integrity

**Target: 100%**

A locked building creates zero fictitious household attempts.

---

## Retention integrity

**Target: 100% in launch testing**

The deletion process executes and prevents old devices from recreating expired identifying records.

---

# 79. User Stories

## Volunteer

As a volunteer, I want one Household represented as one door so I do not visit the same unit twice.

As a volunteer, I want my Assignment stored offline so loss of connectivity does not stop field work.

As a volunteer, I want confirmation only after my work is actually stored so I know it is safe to move to the next door.

As a volunteer, I want to know whether my work is only on my phone or has reached the server.

As a volunteer, I want to retry uploads safely without creating duplicates.

As a volunteer, I want to record a request for application help even if the resident does not provide a phone number.

As a volunteer, I want a locked lobby to be represented honestly instead of marking residents as unavailable.

---

## Administrator

As an administrator, I want invalid or prohibited imports rejected before persistence.

As an administrator, I want grouping problems caught before assignments exist.

As an administrator, I want only authorized volunteers to access each Household.

As an administrator, I want multiple real Visits preserved rather than overwritten.

As an administrator, I want do-not-contact requests to suppress future Campaign outreach.

As an administrator, I want to distinguish Building access failures from actual household attempts.

As an administrator, I want Campaign deletion to run automatically rather than depend entirely on someone remembering to delete records manually.

---

# 80. Acceptance Criteria

## Couple creates one Household assignment

**Given** two People share the same validated Household Key and verified unit
**When** an administrator creates an Assignment
**Then** one Household appears
**And** both People appear beneath it.

---

## Tier 3 never persists

**Given** a CSV contains Tier 1, Tier 2, and one Tier 3 record
**When** the administrator imports it
**Then** the entire import is rejected
**And** no imported Person records are committed
**And** Tier 3 data does not appear in application logs.

---

## Unknown Tier rejects import

**Given** one row contains a blank or unknown Tier
**When** import validation runs
**Then** the entire import is rejected.

---

## Duplicate import

**Given** an approved CSV has already been finalized
**When** the same approved source is submitted again
**Then** no duplicate People, Households, or Buildings are created.

---

## Household grouping conflict

**Given** one Household Key contains two conflicting verified units
**When** validation runs
**Then** the import cannot be finalized
**And** the administrator is told to correct the source file and retry.

---

## Volunteer unauthorized Household request

**Given** Assignment credential A is authorized only for Household 1
**When** the client requests Household 2
**Then** the server rejects the request
**Regardless** of the Household ID supplied by the client.

---

## Volunteer payload minimization

**Given** a volunteer downloads an Assignment
**When** network responses and local storage are inspected
**Then** they do not contain:

* Match Rationale;
* Score;
* Owner of Record;
* Matched Owner Name;
* Other Parcels Matched;
* Tier 3 records;
* exclusion-file records;
* unrelated Households.

---

## Locked building

**Given** a Building Run contains 18 Households
**When** the volunteer records Locked lobby
**Then** one Building Access Attempt is created
**And** zero Household Visits are created
**And** zero Households count as attempted.

---

## Offline save survives browser closure

**Given** an Assignment is Ready Offline
**And** the phone has no connectivity
**When** the volunteer records three Submission Operations
**And** closes the browser
**And** reopens it
**Then** all three remain Saved on device.

---

## Local atomic save

**Given** a Visit includes a Help Request and Correction Report
**When** local storage fails while committing the Submission
**Then** the application does not show Saved on device
**And** no partial Submission is treated as complete.

---

## Server atomic save

**Given** a Submission includes a Visit and Help Request
**When** Help Request persistence fails server-side
**Then** the server does not acknowledge the Submission as received
**And** the Visit is not treated as fully committed.

---

## Lost acknowledgment

**Given** the server commits operation ABC
**And** the network drops before the phone receives acknowledgment
**When** the phone uploads operation ABC again
**Then** the server returns the original acknowledgment
**And** no duplicate records are created.

---

## Same ID, different payload

**Given** operation ABC already exists
**When** the client resubmits ABC with different content
**Then** the server returns an explicit conflict
**And** does not silently overwrite the existing operation.

---

## Edit after lost acknowledgment

**Given** Visit A was committed server-side
**But** the device did not receive acknowledgment
**When** the volunteer edits the saved Visit
**Then** the edit becomes a Revision Operation
**And** Visit A is not duplicated
**And** the Revision does not count as another Household attempt.

---

## Two independent volunteers

**Given** Volunteer A creates Visit A for Household 7
**And** Volunteer B creates Visit B for Household 7
**When** both synchronize
**Then** both Visits remain.

---

## Help Request without phone

**Given** a resident requests application help
**And** provides no phone number
**When** the volunteer saves the Visit
**Then** the Help Request is preserved.

---

## Person-specific correction

**Given** Maria and Luis share one Household
**When** a resident reports Maria moved
**Then** the Correction Report attaches to Maria
**And** Luis is not automatically marked moved.

---

## Do-not-contact local behavior

**Given** the volunteer records an explicit do-not-contact request
**When** the Submission saves locally
**Then** that Household is immediately suppressed in that device's Assignment.

---

## Do-not-contact Campaign behavior

**Given** a do-not-contact request synchronizes
**When** the server processes it
**Then** the Household is suppressed from future Campaign assignments.

---

## Offline suppression race

**Given** Volunteer A synchronizes a do-not-contact request
**And** Volunteer B is already offline with the Household downloaded
**When** Volunteer B records a Visit without knowing about the suppression
**Then** the existing Visit may synchronize under normal authorization rules
**And** the Visit is not erased.

---

## Revoked credential with pending work

**Given** a volunteer has unsynchronized work
**When** the credential is revoked
**Then** subsequent upload is rejected
**And** the app explains the reason
**And** pending local data is not silently erased immediately.

---

## Event ends with pending work

**Given** the Event ends
**When** a volunteer reconnects within the 72-hour synchronization window
**Then** existing pending work may upload
**And** fresh resident data cannot be downloaded.

---

## Campaign expiration

**Given** the Campaign deletion timestamp arrives
**When** an old device attempts to upload
**Then** the identifying upload is rejected
**And** deleted Campaign records are not recreated.

---

## Campaign expiration with open Help Request

**Given** a Help Request remains New at deletion time
**Then** administrators were warned beforehand
**And** the open task does not silently extend retention
**And** identifying data follows the approved deletion behavior.

---

## Application update with pending data

**Given** a device contains unsynchronized Submission Operations
**When** the web application is updated
**Then** pending compatible data remains available
**And** migration failure must not silently discard the operations.

---

# 81. Real-Device Field Test Plan

Use synthetic resident data first.

Test at minimum:

* one recent iPhone with Safari;
* one recent Android device with Chrome.

Synthetic Assignment should include:

* one Household with multiple People;
* one single-person Household;
* one multi-unit Building;
* one Help Request;
* one Correction Report;
* one do-not-contact request;
* one Building access failure.

---

# 82. Field Test Script

## Test 1 — Download

Open private Assignment link.

Download Assignment.

Verify:

**Ready offline**

---

## Test 2 — Airplane mode

Enable airplane mode.

Navigate between multiple Households.

Verify all required data loads.

---

## Test 3 — Create mixed records

Create:

* No answer
* Spoke with resident
* Help Request without phone
* Person moved Correction Report
* do-not-contact request

Verify each saves locally.

---

## Test 4 — Close/reopen

Fully close browser.

Reopen site.

Verify all Saved on device operations survive.

---

## Test 5 — Sync

Restore connectivity.

Tap:

**Sync now**

Verify all operations are received exactly once.

---

## Test 6 — Lost acknowledgment

Simulate server commit followed by lost client acknowledgment.

Retry.

Verify no duplicates.

---

## Test 7 — Edit after ambiguous sync

After simulated lost acknowledgment, edit the Visit.

Verify a Revision is created.

Verify no extra Household attempt is counted.

---

## Test 8 — Partial associated-record failure

Simulate Help Request server failure.

Verify Visit is not falsely acknowledged as fully Received.

---

## Test 9 — Independent Visit

Record two separate Visits from two phones against one synthetic Household.

Verify both survive.

---

## Test 10 — Building access

Record Locked lobby.

Verify:

* one Building Access Attempt;
* zero Household attempts.

---

## Test 11 — Unauthorized Household

Attempt to request a Household outside the Assignment.

Verify server rejection.

---

## Test 12 — Revocation

Download Assignment.

Create pending work.

Revoke credential.

Verify:

* fresh server access stops;
* pending upload is rejected clearly;
* local pending records are not silently deleted.

---

## Test 13 — Event expiration

End Event.

Verify:

* no fresh resident download;
* pending work can upload during sync window.

---

## Test 14 — Campaign deletion

Advance a synthetic Campaign to its deletion timestamp.

Verify:

* scheduled deletion runs;
* identifying server data disappears;
* old device upload cannot recreate it.

---

## Test 15 — Duplicate import

Submit the same approved synthetic CSV twice.

Verify no duplicate records.

---

## Test 16 — Application update

Place unsynchronized work on device.

Deploy/update application.

Reopen.

Verify pending work survives.

---

# 83. Launch Gate

Real resident data must not be used until all of the following pass.

## Access

* [ ] Administrator authentication works
* [ ] Administrator allowlist is configured
* [ ] Private Assignment credentials are high entropy
* [ ] Volunteer credential cannot request unrelated Household
* [ ] Credential expiration behavior passes
* [ ] Credential revocation behavior passes

## Import

* [ ] Approved CSV schema is finalized
* [ ] Tier 3 rejection passes
* [ ] Invalid/blank Tier rejection passes
* [ ] Duplicate-import test passes
* [ ] Household-grouping validation passes
* [ ] Raw upload/log handling has been verified

## Data minimization

* [ ] Volunteer payload contains only permitted fields
* [ ] Prohibited server fields are absent from volunteer local storage
* [ ] Tier 3 data never persists
* [ ] Exclusion-file data never persists

## Offline

* [ ] iPhone Safari Ready Offline test passes
* [ ] Android Chrome Ready Offline test passes
* [ ] Browser close/reopen recovery passes
* [ ] Application update with pending data passes

## Synchronization

* [ ] Duplicate retry test passes
* [ ] Lost acknowledgment test passes
* [ ] Same operation ID/different content conflict passes
* [ ] Atomic Visit + Help Request save passes
* [ ] Two independent Visits both survive
* [ ] Revision does not inflate Visit count

## Field semantics

* [ ] Multi-person Household produces one door
* [ ] Locked Building creates zero Household attempts
* [ ] Help Request saves without phone number
* [ ] Person-specific correction does not affect other Household members
* [ ] do-not-contact suppression works locally and server-side

## Retention

* [ ] Campaign deletion job exists
* [ ] Campaign deletion job has been executed successfully in test
* [ ] Failed deletion is visible to administrator
* [ ] Open Help Request does not extend retention
* [ ] Old device cannot recreate deleted Campaign data
* [ ] Backup behavior has been reviewed

A rough visual design is acceptable.

Failure of these controls is not.

---

# 84. Implementation Sequence

Build complete vertical slices.

Do not build every backend table before proving the field workflow.

## Sequence 1 — Synthetic end-to-end loop

Build:

> one Household → one Assignment → one private link → one locally saved Visit → one server sync → one administrator result

Exit criterion:

The entire path works on a phone.

---

## Sequence 2 — Offline durability

Add:

* Assignment download;
* durable local storage;
* Ready Offline;
* browser close/reopen;
* visible sync state;
* idempotent upload.

Exit criterion:

Offline field test passes on both supported browser families.

---

## Sequence 3 — Atomic field submissions

Add:

* Submission Operation;
* Help Request;
* Correction Report;
* do-not-contact request;
* Revision Operation;
* atomic server processing.

Exit criterion:

Associated-record failure and lost-acknowledgment tests pass.

---

## Sequence 4 — Real hierarchy

Add:

* Buildings;
* Households;
* People;
* grouping logic;
* Building Runs;
* Scattered Doors;
* Building Access Attempts.

Exit criterion:

Multi-person Household and locked-building tests pass.

---

## Sequence 5 — Safe import

Add:

* UTF-8 CSV;
* fixed schema;
* persistence allowlist;
* Tier validation;
* household validation;
* duplicate-import protection;
* safe error/log behavior.

Exit criterion:

Production import safety suite passes.

---

## Sequence 6 — Access lifecycle

Add:

* Event end;
* 72-hour upload-only window;
* revocation;
* Assignment-Household authorization;
* reassignment/supersession.

Exit criterion:

Unauthorized, revoked, and expired access tests pass.

---

## Sequence 7 — Administrator operations

Add:

* Campaigns;
* Events;
* Assignment management;
* results;
* Correction review;
* Help Request states;
* sync-reporting fields.

Exit criterion:

Organizer can run synthetic event without direct database intervention.

---

## Sequence 8 — Retention

Add:

* calculated deletion timestamp;
* scheduled deletion;
* expiration enforcement;
* local cleanup;
* failure visibility;
* backup safeguards.

Exit criterion:

Synthetic Campaign deletion succeeds end to end.

---

# 85. What to Cut First if Time Runs Out

Cut in this order:

1. Visual polish
2. Advanced results presentation
3. Fancy Assignment management UI
4. Task ownership if one administrator can handle follow-up
5. Rich Correction review
6. Program-content editing
7. Export UI
8. Maps
9. Geocoding
10. Automatic routing

Do not cut:

1. Household grouping
2. Tier/data-boundary enforcement
3. Volunteer payload minimization
4. Authorization
5. Durable offline persistence
6. Atomic submission save
7. Idempotent synchronization
8. Building-access separation
9. Help Request without phone
10. Campaign deletion

---

# 86. Implementation Dependencies

These are not additional product-design questions.

They require configuration or verification.

## Administrator identity allowlist

Provide the administrator identities approved for production access.

## Authentication configuration

Select/configure the production administrator-authentication mechanism.

## Hosting/upload verification

Confirm:

* request-body logging;
* temporary-file behavior;
* object-storage behavior;
* application logs;
* backup retention.

## Approved source artifact

Provide the final approved Tier 1 / Tier 2 CSV.

## Approved Program content

Provide current reviewed content for:

* Senior Freeze;
* Stay NJ;
* ANCHOR;

including official source URLs and review date.

---

# 87. Product Principles

## Represent reality, not assumptions

A locked lobby is not 20 unanswered doors.

A person saying they rent is not an eligibility determination.

A correction report is not automatically verified truth.

---

## One door means one Household

People live within Households.

Field assignments operate on Households.

---

## Save before saying saved

The volunteer should never be told work is safe until durable local persistence succeeds.

---

## Retry should be boring

Network failures must not create duplicate Visits, duplicate Help Requests, or duplicate corrections.

---

## History beats last-write-wins

Independent Visits remain independent.

Revisions preserve the original record.

---

## Server authorization beats UI hiding

A Household is inaccessible because the server rejects unauthorized access, not because the frontend omitted a button.

---

## Data minimization means do not deliver it

Unnecessary sensitive source information should not reach volunteer devices.

---

## Retention must execute

A deletion policy is incomplete unless the system actually deletes the data and prevents old devices from recreating it.

---

# 88. Definition of MVP Success

The MVP is successful when a volunteer can:

> receive a private Assignment, download only the information they need, walk into a building with no reception, record what actually happens at each door, close and reopen their browser without losing work, reconnect later, synchronize through safe retries without duplicate effects, and give the administrator an accurate record of the outreach.

And the organization can do that without:

> importing prohibited datasets, exposing unnecessary resident data, turning informational outreach into an eligibility system, manufacturing false door attempts, or retaining Campaign-level identifying information indefinitely.

Build that first.
