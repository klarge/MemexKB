---
name: SAML IdP interoperability
description: A confirmed live IdP setup lesson for diagnosing SAML callback failures without weakening validation.
---

When SAML callback failures surface, align the IdP's ACS, signature, and audience settings with the service-provider metadata before changing validation behavior.

**Why:** A real installation progressed from a POST to the wrong endpoint, through signature failures, to a missing AudienceRestriction. The user confirmed that correcting the IdP's ACS, enabling assertion signing, and including the audience URI resolved the sequence. A generic browser error hid the distinct causes; container logs identified them.

**How to apply:** Ask for the sanitized error text, not a raw SAML response. Match the IdP's Audience URI to the exact metadata entityID and use the metadata's ACS URL. Preserve signature and audience validation; do not disable either as a workaround.