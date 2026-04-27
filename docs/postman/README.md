# Postman collections (AccuSource / SourceDirect)

AccuSource may provide a sample collection (e.g. **C1 Staffing Sample**) for sandbox OAuth and V2 endpoints.

## Do not commit secrets

Vendor-supplied Postman files often contain:

- OAuth **client_id** and **client_secret**
- Cached **access tokens** (short-lived but still sensitive)

Keep the **original** file in **secure storage** (password manager, private drive). **Do not** add unredacted collections to this repository.

## Recommended usage

1. Import the collection into Postman locally.
2. Create a **Postman Environment** with variables such as:
   - `accusource_client_id`
   - `accusource_client_secret`
   - `accusource_token_url` → `https://sdapi-sandbox.accusourcedirect.construction/oauth/access_token`
   - `accusource_api_base` → `https://sdapi-sandbox.accusourcedirect.construction`
3. Replace embedded auth values in the collection with **{{variable}}** references, then save a **redacted** copy if you need to share internally.

## OAuth

Sandbox token URL (typical):  
`https://sdapi-sandbox.accusourcedirect.construction/oauth/access_token`  
Grant: **client_credentials** (see official API docs).

See also [`../SOURCEDIRECT_API_REFERENCE.md`](../SOURCEDIRECT_API_REFERENCE.md).
