import type { Assignment } from "../lib/contracts";

// Source pages checked 2026-09-18. Deliberately no eligibility thresholds,
// promised awards, personalized screening, or application-document collection.
export function outreachPrograms(): Assignment["programs"] {
  const source = "New Jersey Division of Taxation";
  const reviewedAt = "2026-09-18";
  return [
    {
      id: "freeze",
      name: "Senior Freeze",
      source,
      reviewedAt,
      url: "https://www.nj.gov/treasury/taxation/ptr/",
      summary:
        "New Jersey's property-tax reimbursement program. The State sets the requirements for each application year. We can share information and record a request for application help; this visit does not determine eligibility.",
    },
    {
      id: "stay",
      name: "Stay NJ",
      source,
      reviewedAt,
      url: "https://www.nj.gov/treasury/taxation/staynj/",
      summary:
        "A New Jersey property-tax relief program for qualifying senior homeowners. The State's current instructions explain how it works with Senior Freeze and ANCHOR. Inclusion on this outreach list is not an eligibility decision.",
    },
    {
      id: "anchor",
      name: "ANCHOR",
      source,
      reviewedAt,
      url: "https://www.nj.gov/treasury/taxation/anchor/",
      summary:
        "New Jersey property-tax relief for qualifying homeowners and renters. Reporting that you rent does not mean you are ineligible. Refer to the official instructions or ask the organizer for application help.",
    },
  ];
}
