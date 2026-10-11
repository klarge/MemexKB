import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SignedXml } from "xml-crypto";

export async function withEphemeralIdp(
  run: (idp: { privateKey: string; certificate: string }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "memex-saml-test-"));
  try {
    const key = join(directory, "key.pem");
    const cert = join(directory, "cert.pem");
    await promisify(execFile)("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
      "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=isolated-idp.example.test",
    ]);
    await run({
      privateKey: await readFile(key, "utf8"),
      certificate: await readFile(cert, "utf8"),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const escapeXml = (value: string) => value.replace(/[<>&"']/g, character => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[character]!);

/** Sign only the selected element; response and assertion signatures are independent. */
export function signSaml(xml: string, element: "Assertion" | "Response", privateKey: string) {
  const signer = new SignedXml({
    privateKey,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: `//*[local-name(.)='${element}']`,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='${element}']/*[local-name(.)='Issuer']`,
      action: "after",
    },
  });
  return signer.getSignedXml();
}

export function samlResponse(options: {
  audience: string;
  callbackUrl: string;
  email: string;
  assertionKey?: string;
  responseKey?: string;
  omitAudience?: boolean;
  tamperAssertion?: boolean;
  duplicateConditions?: boolean;
}) {
  const now = new Date().toISOString();
  const before = new Date(Date.now() - 60_000).toISOString();
  const after = new Date(Date.now() + 300_000).toISOString();
  const issuer = "<saml:Issuer>https://idp.example.test</saml:Issuer>";
  let xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
    ID="_response_${randomUUID()}" Version="2.0" IssueInstant="${now}" Destination="${escapeXml(options.callbackUrl)}">
    ${issuer}
    <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
    <saml:Assertion ID="_assertion_${randomUUID()}" Version="2.0" IssueInstant="${now}">
      ${issuer}
      <saml:Subject>
        <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${escapeXml(options.email)}</saml:NameID>
        <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
          <saml:SubjectConfirmationData Recipient="${escapeXml(options.callbackUrl)}" NotOnOrAfter="${after}"/>
        </saml:SubjectConfirmation>
      </saml:Subject>
      <saml:Conditions NotBefore="${before}" NotOnOrAfter="${after}">
        ${options.omitAudience ? "" : `<saml:AudienceRestriction><saml:Audience>${escapeXml(options.audience)}</saml:Audience></saml:AudienceRestriction>`}
      </saml:Conditions>
      <saml:AuthnStatement AuthnInstant="${now}" SessionIndex="_session_${randomUUID()}">
        <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
      </saml:AuthnStatement>
      <saml:AttributeStatement>
        <saml:Attribute Name="email"><saml:AttributeValue>${escapeXml(options.email)}</saml:AttributeValue></saml:Attribute>
        <saml:Attribute Name="displayName"><saml:AttributeValue>Isolated SAML user</saml:AttributeValue></saml:Attribute>
      </saml:AttributeStatement>
    </saml:Assertion>
  </samlp:Response>`;
  if (options.duplicateConditions) {
    xml = xml.replace("</saml:Conditions>", "</saml:Conditions><saml:Conditions/>");
  }
  if (options.assertionKey) xml = signSaml(xml, "Assertion", options.assertionKey);
  // Re-sign the enclosing response after tampering: only assertion validation can catch this.
  if (options.tamperAssertion) xml = xml.replace("Isolated SAML user", "Forged SAML user");
  if (options.responseKey) xml = signSaml(xml, "Response", options.responseKey);
  return Buffer.from(xml).toString("base64");
}
