# Messaging Automation Rollout

This rollout guide is for tenant-by-tenant cutover from legacy trigger sends to
the rule-driven automation backbone.

## 1) Deploy in passive mode

Set env var `MESSAGE_AUTOMATION_PASSIVE_MODE=true` for functions runtime and
deploy. In passive mode, rules are resolved and logged, but outbound send is
skipped.

## 2) Seed baseline automation rules

For each tenant:

- Create rules in `tenants/{tenantId}/messageAutomationRules/{ruleId}`.
- Keep rules in `draft` while validating template rendering.
- Ensure `triggerKey`, `templateId`, and at least one delivery channel are set.

## 3) Validate render + variable diagnostics

Use `testAutomationTemplateApi` with `send=false` and confirm:

- Expected template is resolved.
- `missingVariables` is empty for happy-path records.
- Rendered output matches channel expectations.

## 4) Tenant pilot enablement

For pilot tenants:

- Set selected rules to `active`.
- Flip runtime to `MESSAGE_AUTOMATION_PASSIVE_MODE=false`.
- Monitor logs for `dispatchSystemMessage` errors and channel provider failures.

## 5) Logging validation checklist

Confirm message logs include:

- `triggerKey`
- `ruleId`
- `templateId`
- channel dispatch status and provider response metadata

## 6) Legacy fallback retirement

After stable pilot:

- Keep legacy helper wrappers in place for call-site compatibility.
- Continue no-fallback behavior for `smsTemplates` in
  `getTemplateWithLegacyFallback`.
- Remove any remaining direct `smsTemplates` dependencies in product surfaces.

## 7) Full tenant rollout

- Enable active rules tenant-by-tenant.
- Keep rollback path by switching runtime back to passive mode.
- Track send success rates and user opt-out/consent outcomes per tenant.
