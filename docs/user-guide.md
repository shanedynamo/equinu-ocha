# User Guide

Getting started as a user of the Dynamo AI Platform.

## Authentication

Sign in with your organization's Entra ID credentials. Access is controlled by your administrator.

## Using the API

Send a POST request to `/api/chat` with your session token:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, Claude"}'
```
