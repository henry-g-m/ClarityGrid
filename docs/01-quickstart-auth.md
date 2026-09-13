# Quickstart & Authentication

Source: https://claritygrid.net/api-quickstart/

## Getting an account
1. Contact Clarity Grid to request an account → receive a contract by email.
2. Review/submit the contract → receive your **API Key** (`uu_id`) and technical support contacts.
3. Explore the interactive demo at https://api.claritygrid.net/ (shows endpoints, query params, payload/response formats, error handling).

## Login / Auth flow
**Endpoint:** `POST https://map.claritygrid.net/ecservice/login`

| Field | Type | Description |
|---|---|---|
| `uu_id` | string | Unique API key |
| `app_group` | string | App group user is logging in as, e.g. `"API"` |

**Sample payload:**
```json
{
  "uu_id": "yourapikeyhere",
  "app_group": "API"
}
```

The response returns a **cookie** (seen elsewhere named `ecservicesessions`) that must be
attached to all subsequent requests as a header/cookie for auth.

### Sample Python (from docs, using `requests` + `simplejson`)
```python
import requests
import simplejson as json

host = 'https://map.claritygrid.net'

# login to get session (authcookie) using your api secret
url = host + '/ecservice/login'
postbody = {"uu_id": "yourApiSecretGoesHere", "app_group": "API"}
header = {"content-type": "application/json"}
response = requests.post(url, data=json.dumps(postbody), headers=header, verify=True)
authcookie = response.cookies

# GET ALL DISTRIBUTOR(S) FOR ISO:
# ISO values: 1-NEISO, 2-NYISO, 3-PJM, 4-MISO, 5-CAISO, 6-SPP, 7-ERCOT, 8-SERC, 9-WECC
url = host + '/ecservice/api/distributors?operator_id=5'
header = {"content-type": "application/json"}
response = requests.get(url, headers=header, verify=True, cookies=authcookie)
# a 401 here means auth failed

rsp_json = response.json()
for dist in rsp_json:
    print(dist["name"])
    print(dist["id"])
```

## Response format
All responses are JSON. Example (zipcode → distributors → tariffs):
```json
{
  "zipcode": "10002",
  "city_name": "New York",
  "state_code": "NY",
  "latitude": 40.71704,
  "longitude": -73.987,
  "distributors": [
    {
      "id": 2298,
      "name": "Consolidated Edison Co. Of NY-Zone J",
      "operator_id": 2,
      "tariffs": [
        {
          "consumption_id": 2,
          "consumption_name": "Commercial",
          "name": "C-9 Gen Serv -Low Tension (NYC Zone J)",
          "id": 12138,
          "notes": "..."
        }
      ]
    }
  ]
}
```

## HTTP Status Codes
| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Bad Request — bad syntax or auth failure |
| 401 | Unauthorized — missing/invalid credentials |
| 403 | Forbidden — private data, no access |
| 404 | Not Found — bad URL or nonexistent resource |
| 500 | Server Error |
| 503 | Service Unavailable |
