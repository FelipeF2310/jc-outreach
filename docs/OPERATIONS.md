# Organizer and volunteer handoff

Prepared September 20, 2026. This is an operating guide, not approval that all field-launch checks have passed. Rehearse with the existing **Synthetic** campaigns; never record demonstration visits against real Ward A households.

## Administrator: prepare a pair

1. Sign in at the approved hosted `/admin` page. Select **Ward A Benefits Outreach** and confirm the campaign, event cutoff and deletion date. The saved event currently ends October 18 at **5:00 PM ET**; that is a month-long work-package cutoff, not a daily volunteer shift schedule.
2. Under **Volunteer assignments**, find **Pair 01** through **Pair 10**. Open **View assigned doors**. After the resident-name update is installed and published, each address/unit has its listed residents underneath. A couple remains one door. If names are unavailable, refresh assignments; contact the website owner if the message remains. Do not reimport to fix a display problem.
3. Review the geography with the field organizer. These are Block/Lot/address-ordered drafts with whole buildings kept together, **not verified walking routes**. The same lot number alone does not establish proximity. Coordinate any **Reassign doors** action with both affected pairs; an offline phone will still have its old list.
4. Open **Volunteer links** on the intended pair. Enter the **Volunteer / link name**, for example `Pair 01 — Saturday`, or add the two volunteers' names when known. Existing pair labels stay in place; this field names the newly issued link, not the assignment or an authenticated identity. Names can remain unspecified until the organizer has them.
5. Generate one private link for the pair, copy it immediately and send it privately to the designated recorder. The server cannot display the secret again after the issuance screen closes. A new link does not automatically revoke the old one. Do not put private URLs in GitHub, public documents, screenshots or group announcements.
6. Use **one recording phone per pair** for the pilot. Two phones do not share pending local work or a single completion state. If the pair needs to change devices, first sync the original phone and coordinate with the organizer; do not clear its browser data.
7. Confirm the recorder downloaded the correct assignment and sees **Ready offline**. Keep an organizer contact available through the team's normal communication channel; the app does not provide a messaging service.

Do not issue real links merely to test failure cases. Use a practice campaign and synthetic records. Link issuance and distribution are separate from preparing this guide.

## Volunteer: short instructions to send with the link

1. Open your private link in normal **Safari on iPhone** or **Chrome on Android**, not a private/incognito session or an embedded messaging-app browser. Do not forward the link.
2. While connected, tap **Download assignment**. Check the pair, addresses and door count. Wait for **Ready offline** before starting.
3. Open a household to see the listed residents. One address/unit is one door, even when several people are listed. Provide reviewed program information; the list does not determine eligibility.
4. Select what actually happened and tap **Save & next**. Wait for **Saved on this device**. If saving fails, keep the screen open and contact the organizer; do not assume it was recorded.
5. Use **Cannot access building** for a locked lobby, not a separate unanswered visit for every unit. Record application-help requests even without a phone number. Capture a phone only when resident-provided with permission for that follow-up. An explicit **do-not-contact** request is different from declining today's conversation.
6. When connected, tap **Sync now**. **Saved on device** is not a server receipt. If some records remain pending or are rejected, keep the browser/site data and notify the organizer; do not repeatedly create the same visit as a workaround.
7. At the end, mark **Field work finished**, then **Sync now**. Wait for **Finished and synchronized**. Tell the organizer about unvisited doors, blocked buildings and any pending work. Finishing does not turn unvisited doors into attempts.

Clearing browser/site data can remove unsynchronized work. Do not force an app update, replace the assignment, or switch recording devices while work is pending. A disconnected phone cannot immediately receive a reassignment, suppression or revocation.

## Administrator: after the walk

- Select the pair in **Results & follow-up**, refresh results and check received visits and browser completion reports. A server receipt is evidence of received work; it cannot prove an unknown disconnected phone is empty.
- Review **Application help** and **Resident corrections**. Keep follow-up permission and do-not-contact restrictions visible. Reviewing a correction does not verify the report or alter imported people.
- Before a routine link replacement/revocation, arrange pending-work synchronization. For a lost or compromised link, revoke access promptly and tell the organizer that pending uploads from that credential will also be blocked. Revocation cannot remotely erase an offline copy.
- Check deletion health and unresolved-help warnings. Existing campaign deadlines still apply to open tasks, private links and saved names. Local source files and external copies require separate deletion under the policy; do not create an archive to bypass the deadline.

## Future CSVs: controlled engineering import

The self-service uploader is deferred by the owner. Keep each approved file local and provide its path to the engineer; do not paste resident rows into chat or commit them. The workflow remains approval of the exact source, Tier 1/2/schema/grouping validation, minimized persistence, explicit campaign/assignment plan, atomic import and saved-state verification. Tier 3, renter-exclusion data and voter-file enrichment remain outside the product.

An unchanged finalized file may be retried without duplicating records. A different CSV **cannot overwrite an active campaign's finalized import**. New campaigns use a new approved plan and IDs; a correction/addition to an existing campaign needs a separately reviewed update that preserves visits, assignments, suppression and deadlines. Do not create another campaign solely to bypass current-campaign do-not-contact suppression. This is an engineer-assisted process, not an unattended scheduled import or a promise of immediate availability.

## Safety checks still requiring an operator walkthrough

- Actual administrator sign-in/sign-out and allowlist behavior after the release; owner-assisted account recovery and provider rate-limit settings. Do not change the two working administrators' passwords or remove their access just to test this. Use an explicitly approved disposable account if needed, verify identity independently, keep credentials out of chat, and verify session handling before marking recovery passed.
- A separately reviewed hosted deletion-failure/retry exercise, using disposable synthetic records only. Do not disable the production schedule or alter Ward A deadlines to simulate failure. Local rollback/retry tests and a healthy hosted heartbeat are not that exercise.
- Organizer confirmation of pair geography, event cutoff and the name-display walkthrough; volunteer names/contact arrangements when available.

The additional offline/update investigations are deferred by request, not resolved. See [acceptance evidence](ACCEPTANCE.md) and [current plan](PLAN.md). No full-field-readiness claim follows from this guide.
