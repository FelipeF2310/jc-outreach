# Synthetic preparation fixtures

All names, identifiers, and street names here are invented. These JSON files are development inputs, not production outreach artifacts and not yet app-importable files.

`outreach.json` contains four synthetic source records: four people, three households, and two buildings. It includes the exact 21 source headers, including fields that must be discarded or withheld from volunteers. Source identifiers and ZIPs are strings.

`import-cases.json` describes transformations of those records for later importer tests. `sourceRow` is a zero-based index into the base records. Apply each case independently: deep-copy the base, then apply listed overrides, field deletions, or appended copies. Expected outcomes are product test expectations, not evidence that an importer exists or passed.

Generate any eventual CSV from this data with a proper CSV library so commas and quotes are escaped correctly. CSV output is ignored by Git by default. Do not add genuine resident records as fixtures.
