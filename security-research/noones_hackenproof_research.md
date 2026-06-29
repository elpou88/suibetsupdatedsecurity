# NoOnes.com — Bug Bounty Research Report
**Platform:** HackenProof  
**Target:** https://noones.com  
**Researcher:** elpou88  
**Research Date:** April 9, 2026  
**Status:** Findings ready for submission (needs HackenProof account ≥ 100 points)

---

## Executive Summary

NoOnes.com is a P2P Bitcoin marketplace. This research focused on the OAuth/OIDC authentication infrastructure (`auth.noones.com`), API surface, and information disclosure issues. Several OAuth security misconfigurations were found that violate current OAuth 2.0 Security Best Current Practice (RFC 9700) and could allow token leakage or privilege escalation.

---

## Reconnaissance Summary

### Infrastructure Discovered

| Asset | Notes |
|-------|-------|
| `noones.com` | Main frontend — Next.js 13 app, Cloudflare CDN |
| `auth.noones.com` | OAuth 2.0 / OIDC authorization server (Django OAuth Toolkit) |
| `api.noones.com` | Backend REST API server |
| `dev.noones.com` | Developer portal for third-party app (OAuth client) registration |
| `sentry.noones.com` | Self-hosted Sentry error tracking |
| `static.noones.com` | S3-backed static assets (CDN, bucket listing: Access Denied) |
| `status.noones.com` | NoOnes system status page |
| S3 Bucket `blabs-marketplace-avatars-prod` | Internal project codename "blabs" leaked via S3 URL |

### OAuth Client ID (Real Production Value)
Found in page source of `/login`:
```
h9VAgMcfYPfoBaihBIfKt7An7UwFon5aKFjrm68dzFdxZ7Tj
```

### Key API Endpoints Discovered (Unauthenticated)

| Endpoint | Method | Auth Required | Notes |
|----------|--------|---------------|-------|
| `/rest/v3/user/me` | GET | No | Returns location, analytics IDs |
| `/rest/v3/marketplace/user/me` | GET | No | Returns default user config |
| `/rest/v1/offers` | GET | No | Full offer listings with user data |
| `/rest/v2/payment-methods` | GET | No | 467 payment methods |
| `/rest/v2/countries` | GET | No | Country data |
| `/rest/v3/stats` | GET | No | Platform statistics |
| `/rest/v3/kyc/verifications/personal-data` | GET | **Yes** | KYC data — IDOR target (needs account) |
| `/rest/v3/zendesk/jwt-token` | GET | **Yes** | Support JWT — needs account |
| `/rest/v3/zoho/jwt-token` | GET | **Yes** | CRM JWT — needs account |
| `/rest/v1/users/process-avatar` | POST | **Yes** | Avatar upload — file upload target |

---

## Findings

---

### FINDING-01: OAuth Implicit Flow Enabled (response_type=token)
**Severity:** Medium  
**CWE:** CWE-319 (Cleartext Transmission of Sensitive Information via URL)  
**CVSS 3.1:** 5.3 (AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N)

#### Description
The OIDC authorization server at `auth.noones.com` advertises support for `response_type=token` and `response_type=id_token` in its discovery document. This enables the OAuth 2.0 Implicit Flow, which the OAuth 2.0 Security Best Current Practice (RFC 9700) deprecates and recommends against.

#### Evidence
```
GET https://auth.noones.com/.well-known/openid-configuration

Response:
{
  "response_types_supported": [
    "code",
    "token",          ← Implicit flow: access token in URL
    "id_token",       ← Implicit flow: ID token in URL
    "code token",
    "code id_token",
    "token id_token",
    "code token id_token",
    "none"
  ],
  ...
}
```

**Confirmation of implicit flow working:**
```
GET https://auth.noones.com/oauth2/authorize?
  client_id=h9VAgMcfYPfoBaihBIfKt7An7UwFon5aKFjrm68dzFdxZ7Tj
  &redirect_uri=https://noones.com/login/callback
  &response_type=token    ← implicit flow
  &scope=openid
  &state=test123

Response: HTTP 302 → redirects to login page (i.e., the server accepts this request)
```

#### Impact
With implicit flow enabled:
- Access tokens appear in URL fragments (`#access_token=...`) after authentication
- Tokens are logged in browser history, web server access logs, Referrer headers, and browser extensions
- If a victim is lured into a crafted authorization URL (e.g., via phishing email), their token can be captured via a Referrer leak on a page the attacker controls
- Especially dangerous combined with the `staff` scope (see FINDING-03)

#### Recommendation
- Remove `token` and `id_token` from `response_types_supported`
- Disable the implicit grant type entirely
- Enforce Authorization Code + PKCE flow for all clients

---

### FINDING-02: OAuth Server Accepts Unregistered Client IDs Without Error
**Severity:** Medium  
**CWE:** CWE-285 (Improper Authorization)

#### Description
The OAuth 2.0 authorization endpoint at `auth.noones.com/oauth2/authorize` does NOT reject unregistered or invalid `client_id` values. Instead, it redirects the user to the login page, deferring client validation until after authentication.

Per RFC 6749 Section 4.1.2.1, the authorization server MUST validate the `client_id` BEFORE redirecting to any URI or prompting the user to authenticate.

#### Evidence
```bash
# Completely fake client ID + external redirect URI
curl -I "https://auth.noones.com/oauth2/authorize?\
  client_id=FAKE_CLIENT_12345\
  &redirect_uri=https://evil.com\
  &response_type=code\
  &scope=openid"

# Result:
HTTP/2 302
Location: https://noones.com/id/login?next=https%3A//auth.noones.com/oauth2/authorize
  %3Fclient_id%3DFAKE_CLIENT_12345%26redirect_uri%3Dhttps%3A//evil.com%26...
```

The server stores the malicious `redirect_uri` in the `next` parameter chain and will attempt to process it post-authentication.

#### Impact
- An attacker could potentially intercept the token/code if `redirect_uri` validation is also delayed
- Information leakage: error messages post-authentication might reveal timing/oracle information about client registration
- Denial of service: spamming login pages with crafted OAuth URLs to create confusion

#### Recommendation
- Validate `client_id` at the authorization endpoint BEFORE redirecting to login
- Return an HTTP 400 with `error=invalid_client` for unknown client IDs immediately

---

### FINDING-03: `staff` Scope Advertised in OIDC Discovery Document
**Severity:** Low–Medium  
**CWE:** CWE-200 (Exposure of Sensitive Information)

#### Description
The OIDC discovery document at `auth.noones.com/.well-known/openid-configuration` publicly exposes a `staff` scope, which suggests privileged access control tiers exist in the token system.

#### Evidence
```json
{
  "scopes_supported": [
    "openid",
    "profile",
    "email",
    "phone",
    "address",
    "citizenship",
    "status",
    "staff"    ← Internal privileged scope exposed publicly
  ]
}
```

Additionally, requesting `scope=openid+profile+staff` in the authorization URL does NOT return an error — the server accepts and processes the request:
```
GET /oauth2/authorize?...&scope=openid+profile+staff → HTTP 302 (accepted)
```

#### Impact
- The existence of a `staff` scope reveals the internal privilege model
- A regular user who can somehow obtain a token with `staff` scope would have elevated access
- Without an account, it's not confirmed whether non-staff tokens are issued with this scope, but the server does not reject the request at the authorization step

#### Recommendation
- Remove `staff` from the publicly advertised `scopes_supported` list
- Ensure server-side scope validation prevents non-staff users from ever receiving tokens with `staff` scope
- Consider a separate internal-only OAuth server for staff access

---

### FINDING-04: PKCE `plain` Code Challenge Method Supported
**Severity:** Low  
**CWE:** CWE-327 (Use of a Broken or Risky Cryptographic Algorithm)

#### Description
The authorization server supports both `S256` and `plain` PKCE code challenge methods. The `plain` method is cryptographically weaker: if an attacker can observe the `code_challenge` in the authorization URL, they can compute the `code_verifier` directly (since `plain` means `code_challenge = code_verifier`).

#### Evidence
```json
{
  "code_challenge_methods_supported": [
    "plain",   ← Weak: code_challenge = code_verifier (no hashing)
    "S256"     ← Strong: code_challenge = BASE64URL(SHA256(code_verifier))
  ]
}
```

#### Impact
If a mobile app uses `plain` PKCE and the authorization URL is observable (e.g., via device logs or a malicious app), the `code_verifier` is immediately known, defeating PKCE's protection.

#### Recommendation
Remove `plain` from supported methods; require `S256` exclusively (per OAuth 2.0 Security BCP, Section 2.1.1).

---

### FINDING-05: `none` Token Endpoint Authentication Method Supported
**Severity:** Informational  
**CWE:** CWE-306 (Missing Authentication for Critical Function)

#### Description
The token endpoint supports `none` as a client authentication method, allowing clients to authenticate without any secret.

#### Evidence
```json
{
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "none"   ← No client secret required
  ]
}
```

#### Impact
While `none` is legitimate for public clients using PKCE, this should be explicitly constrained so that confidential clients (those with registered secrets) cannot downgrade to `none`.

#### Recommendation
Ensure confidential clients (those with `client_secret` registered) are not permitted to use `none`; enforce `client_secret_basic` or `client_secret_post` for them.

---

### FINDING-06: Session Cookie Missing `SameSite` Attribute
**Severity:** Low  
**CWE:** CWE-1275 (Sensitive Cookie with Improper SameSite Attribute)

#### Description
The main session cookie `noones_p2p` is set without a `SameSite` attribute. While modern browsers default to `SameSite=Lax`, older browsers send this cookie with all cross-site requests, enabling CSRF attacks.

#### Evidence
```http
Set-Cookie: noones_p2p=...; expires=...; Max-Age=1209600; path=/; secure; httponly
# Missing: SameSite=Strict or SameSite=Lax
```

Similarly, the CSRF protection cookie:
```http
Set-Cookie: XSRF-TOKEN=...; expires=...; Max-Age=1209600; path=/; secure
# Missing: SameSite attribute
```

#### Recommendation
Add `SameSite=Lax` (or `Strict`) to all sensitive cookies.

---

### FINDING-07: Sentry DSN Exposed in Page Source
**Severity:** Informational  
**CWE:** CWE-200 (Exposure of Sensitive Information)

#### Description
The Sentry DSN (which contains a public key for submitting error events) is hardcoded and visible in the page's inline script.

#### Evidence
In the HTML source of `https://noones.com/id/admin`:
```javascript
window.appSentryDsn = "https://b902a438a7e53c4c6a86d2238ccca250@sentry.noones.com/86";
```

#### Impact
An attacker can use the DSN to:
- Submit fake/spoofed error events to the NoOnes Sentry project
- Pollute error tracking dashboards with noise
- Potentially trigger false security alerts

Note: The DSN public key allows event submission only; reading events requires authenticated API token.

#### Recommendation
- Avoid embedding Sentry DSN in public page source (use server-side error reporting instead)
- Rate-limit the Sentry DSN using project-level ingest rate limits
- Rotate the DSN if deemed necessary

---

### FINDING-08: Backend Project Name Leaked via S3 Bucket URL
**Severity:** Informational  
**CWE:** CWE-200

#### Description
User avatar URLs expose the internal backend project name `blabs`:
```
https://blabs-marketplace-avatars-prod.s3.eu-central-1.amazonaws.com/avatar/...
```

This reveals that the backend was originally (or internally is still) codenamed "blabs" — distinct from the public "NoOnes" / "Paxful" branding.

#### Recommendation
Use CloudFront or a reverse proxy to serve S3 assets under a branded domain (e.g., `media.noones.com`) to hide the internal bucket name.

---

## Authentication Flow Analysis

The full login flow:
1. User visits `noones.com/login`
2. Redirected to `auth.noones.com/oauth2/authorize?client_id=h9VAgMcfYP...&redirect_uri=https://noones.com/login/callback&response_type=code&scope=openid`
3. Auth server prompts login at `noones.com/id/login?next=https://auth.noones.com/...`
4. User authenticates via username/password (or Google/Apple social login)
5. Auth code sent to `noones.com/login/callback?code=...`
6. Frontend exchanges code for access token at `/oauth2/token`

**Social login endpoints discovered:**
- `/id/register/google?token=<google_id_token>`
- `/id/register/facebook?token=<fb_token>`
- `/id/register/apple?token=<apple_token>` (note: iOS app was double-encoding — uses `atob()` to decode)

---

## Next Steps (Requiring Account Registration)

The following high-severity checks require an authenticated account:

| Target | Attack Vector | Expected Severity |
|--------|---------------|-------------------|
| `/rest/v3/kyc/verifications/personal-data` | IDOR — can account A access account B's KYC? | High–Critical |
| `/rest/v3/zendesk/jwt-token` | Can the JWT be forged to access other users' tickets? | Medium–High |
| `/rest/v1/users/process-avatar` | File upload: SVG for stored XSS, SSRF via URL fetch | Medium–High |
| Trade release/cancel flow | Can trades be cancelled or escrow released without proper auth? | Critical |
| OAuth scope=staff | After auth, does a regular user receive `staff` scope if requested? | High–Critical |
| CSRF on trade actions | Does `X-Csrf-Token` validation have gaps? | Medium–High |

---

## Attack Scenario: OAuth Token Phishing via Implicit Flow

An attacker could craft a phishing link exploiting FINDING-01 and FINDING-02:

```
https://auth.noones.com/oauth2/authorize?
  client_id=h9VAgMcfYPfoBaihBIfKt7An7UwFon5aKFjrm68dzFdxZ7Tj
  &redirect_uri=https://noones.com/login/callback   ← valid URI (or external if bypass works)
  &response_type=token   ← implicit: token in URL fragment
  &scope=openid profile
  &state=abc123
```

If the victim is already logged in, the browser immediately receives:
```
https://noones.com/login/callback#access_token=VICTIM_TOKEN&token_type=Bearer&...
```

If any redirect to attacker-controlled page follows (open redirect, referrer leak, embedded iframe), the token is compromised.

**Worst-case (unconfirmed without account):** If `redirect_uri` is not validated against the registered list, replace `redirect_uri` with `https://evil.com` and the token goes directly to the attacker.

---

## Tools Used
- `curl` for HTTP request analysis
- Playwright (Chromium) for live network traffic capture  
- Custom JavaScript analysis for Next.js chunk mining
- Standard OIDC discovery document analysis

---

## Disclosure Intent
These findings will be submitted to HackenProof for the NoOnes.com bug bounty program.  
Only non-destructive, passive reconnaissance techniques were used.  
No accounts were created, no user data was accessed, and no production systems were modified.
