# AI Context + Firestore + Strategy Conversation (ChatGPT to Cursor)

## 🌟 Summary

You're building the **admin web app for HRXOne**, which will power apps like Companion. You want to integrate OpenAI in a way that supports contextual reasoning across Customers, Employees, and Admin instructions — with weighting, memory, and structured evolution over time.

---

## ❓ Key Questions + Answers

### 1. **Does the AI remember or learn?**

> By default, OpenAI via API is stateless — it doesn't remember anything unless you store and inject context again.

- You need to **persist important data in Firestore**.
- For example, if the AI gives a great recommendation to a customer, you **store that output**, tag it, and optionally embed it for later retrieval.
- You can then **build a vector DB or Firestore-based memory layer** that powers future prompts.

---

### 2. **How should we organize context data?**

#### Recommended Context Groups:
- **Customer**: org chart, manager styles, mission
- **Employee**: satisfaction scores, feedback, behavioral trends
- **Admin**: internal override rules, tone guidance, legal limits

#### Store as:
```jsonc
/customers/{customerId}/aiSettings
/customers/{customerId}/aiContext
/appAiSettings/globalDefaults
/appAiSettings/contextJourneys
/customerBenchmarks/{customerId}