# Freshsales to HRX CRM Import Strategy

## Overview

This document outlines the strategy for importing data from Freshsales CSV exports into the HRX CRM system, ensuring proper relationships between salespeople, companies, contacts, and deals.

## Import Strategy

### 1. **Salespeople Placeholders** (Foundation)
- **Why**: Salespeople are the foundation that companies and contacts reference
- **Process**: 
  - Extract unique salespeople from both companies and contacts CSV
  - Create placeholder records in `crm_salespeople` collection
  - Store Freshsales ID and name for later linking
  - No email invitations (emails are customer contacts, not internal team)

### 2. **Companies Second** (Accounts)
- **Why**: Contacts reference companies, so companies must exist first
- **Process**:
  - Import company data with proper field mapping
  - Link to salesperson using the mapped IDs
  - Set default status as "lead" for imported companies
  - Preserve Freshsales ID for future reference

### 3. **Contacts Third** (People)
- **Why**: Contacts need both salespeople and companies to exist
- **Process**:
  - Import contact data with company associations
  - Link to salespeople using mapped IDs
  - Set default role as "other" (can be updated later)
  - Preserve Freshsales ID for future reference

### 4. **Deals Last** (Opportunities)
- **Why**: Deals reference both companies and contacts
- **Process**:
  - Import deal data with proper relationships
  - Link to companies and contacts using mapped IDs
  - Set appropriate pipeline stages

## Field Mapping

### Company Fields
```javascript
{
  'Id': 'freshsalesId',           // Preserve original ID
  'Name': 'name',                 // Company name
  'Industry type': 'industry',    // Industry classification
  'Phone': 'phone',               // Company phone
  'Website': 'website',           // Company website
  'Address': 'address',           // Street address
  'City': 'city',                 // City
  'State': 'state',               // State
  'Zipcode': 'zipcode',           // ZIP code
  'Country': 'country',           // Country
  'Sales owner id': 'salesOwnerId', // Link to salesperson
  'Sales owner': 'salesOwnerName',  // Salesperson name
  'Tags': 'tags',                 // Comma-separated tags
  'Created at': 'createdAt',      // Original creation date
  'Updated at': 'updatedAt'       // Last update date
}
```

### Contact Fields
```javascript
{
  'Id': 'freshsalesId',           // Preserve original ID
  'First name': 'firstName',      // Contact first name
  'Last name': 'lastName',        // Contact last name
  'Email': 'email',               // Contact email
  'Phone': 'phone',               // Contact phone
  'Company id': 'companyId',      // Link to company
  'Company': 'companyName',       // Company name
  'Sales owner id': 'salesOwnerId', // Link to salesperson
  'Sales owner': 'salesOwnerName',  // Salesperson name
  'Title': 'title',               // Job title
  'Tags': 'tags',                 // Comma-separated tags
  'Created at': 'createdAt',      // Original creation date
  'Updated at': 'updatedAt'       // Last update date
}
```

## Data Processing Steps

### Step 1: Extract Salespeople
```javascript
// From companies CSV
companies.forEach(company => {
  if (company['Sales owner id'] && company['Sales owner']) {
    salespeopleMap.set(company['Sales owner id'], {
      freshsalesId: company['Sales owner id'],
      name: company['Sales owner'],
      email: '', // Will need manual input
      phone: ''
    });
  }
});

// From contacts CSV
contacts.forEach(contact => {
  if (contact['Sales owner id'] && contact['Sales owner']) {
    salespeopleMap.set(contact['Sales owner id'], {
      freshsalesId: contact['Sales owner id'],
      name: contact['Sales owner'],
      email: '', // Will need manual input
      phone: ''
    });
  }
});
```

### Step 2: Create Salesperson Placeholders
```javascript
for (const salesperson of salespeople) {
  // Create placeholder record
  const salespersonDoc = await addDoc(collection(db, 'tenants', tenantId, 'crm_salespeople'), {
    name: salesperson.name,
    freshsalesId: salesperson.freshsalesId,
    email: '', // Will be filled when actual salesperson is added
    phone: '',
    status: 'placeholder', // Indicates this is a placeholder
    linkedUserId: null, // Will be linked to actual user account later
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  salespeopleMap.set(salesperson.freshsalesId, salespersonDoc.id);
}
```

### Step 3: Import Companies
```javascript
for (const company of companies) {
  const companyDoc = await addDoc(collection(db, 'tenants', tenantId, 'crm_companies'), {
    name: company[companyMapping['Name']],
    industry: company[companyMapping['Industry type']],
    phone: company[companyMapping['Phone']],
    website: company[companyMapping['Website']],
    address: company[companyMapping['Address']],
    city: company[companyMapping['City']],
    state: company[companyMapping['State']],
    zipcode: company[companyMapping['Zipcode']],
    country: company[companyMapping['Country']],
    status: 'lead', // Default status for imported companies
    tier: 'C', // Default tier
    tags: company[companyMapping['Tags']] ? 
      company[companyMapping['Tags']].split(',').map(tag => tag.trim()) : [],
    salesOwnerId: company[companyMapping['Sales owner id']], // Store Freshsales ID
    salesOwnerName: company[companyMapping['Sales owner']], // Store name for display
    salesOwnerRef: salespeopleMap.get(company[companyMapping['Sales owner id']]), // Reference to placeholder
    source: 'freshsales_import',
    freshsalesId: company[companyMapping['Id']],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  companiesMap.set(company[companyMapping['Id']], companyDoc.id);
}
```

### Step 4: Import Contacts
```javascript
for (const contact of contacts) {
  const companyId = companiesMap.get(contact[contactMapping['Company id']]);
  
  await addDoc(collection(db, 'tenants', tenantId, 'crm_contacts'), {
    fullName: `${contact[contactMapping['First name']]} ${contact[contactMapping['Last name']]}`.trim(),
    firstName: contact[contactMapping['First name']],
    lastName: contact[contactMapping['Last name']],
    email: contact[contactMapping['Email']],
    phone: contact[contactMapping['Phone']],
    title: contact[contactMapping['Title']],
    companyId: companyId,
    salesOwnerId: contact[contactMapping['Sales owner id']], // Store Freshsales ID
    salesOwnerName: contact[contactMapping['Sales owner']], // Store name for display
    salesOwnerRef: salespeopleMap.get(contact[contactMapping['Sales owner id']]), // Reference to placeholder
    role: 'other', // Default role
    status: 'active',
    tags: contact[contactMapping['Tags']] ? 
      contact[contactMapping['Tags']].split(',').map(tag => tag.trim()) : [],
    freshsalesId: contact[contactMapping['Id']],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}
```

## Pre-Import Checklist

### 1. **Salespeople Setup**
- [ ] Identify all unique salespeople from CSV data
- [ ] Collect email addresses for salespeople (not in CSV)
- [ ] Decide on security levels for each salesperson
- [ ] Prepare email templates for invitations

### 2. **Data Validation**
- [ ] Check for duplicate companies in CSV
- [ ] Validate email formats for contacts
- [ ] Ensure company IDs match between companies and contacts
- [ ] Check for missing required fields

### 3. **System Preparation**
- [ ] Ensure CRM module is enabled
- [ ] Set up default pipeline stages
- [ ] Configure default tags and categories
- [ ] Test import with small sample data

## Post-Import Tasks

### 1. **Salespeople Management**
- [ ] Add actual salespeople to the system via user management
- [ ] Use the linking utility to connect salespeople to placeholders
- [ ] Update all company and contact references
- [ ] Train salespeople on new system

### 2. **Data Cleanup**
- [ ] Review and update company statuses
- [ ] Assign proper tiers to companies
- [ ] Update contact roles and titles
- [ ] Merge duplicate records if any

### 3. **Deals Migration**
- [ ] Import deals with proper stage mapping
- [ ] Link deals to companies and contacts
- [ ] Set up proper revenue tracking
- [ ] Configure pipeline stages

## Error Handling

### Common Issues
1. **Missing Salespeople**: Create placeholder accounts with pending invites
2. **Invalid Emails**: Skip contacts with invalid emails, log for review
3. **Duplicate Companies**: Use first occurrence, log duplicates
4. **Missing Company IDs**: Create orphaned contacts, flag for review

### Recovery Process
1. **Partial Import**: System supports resuming from any step
2. **Data Validation**: Built-in validation prevents invalid imports
3. **Rollback**: Each step is atomic, can be rolled back if needed
4. **Logging**: Comprehensive logging for troubleshooting

## Success Metrics

### Import Success Rate
- Companies: Target 95%+ success rate
- Contacts: Target 90%+ success rate
- Salespeople Placeholders: Target 100% success rate

### Data Quality
- Email validation: 100% valid emails
- Company associations: 95%+ contacts linked to companies
- Salesperson assignments: 100% companies and contacts assigned

### User Adoption
- Salespeople invitations: 80%+ acceptance rate
- Data usage: 70%+ imported data actively used within 30 days

## Implementation Timeline

### Week 1: Preparation
- Set up import system
- Validate CSV data
- Prepare salespeople list

### Week 2: Import
- Import salespeople
- Import companies
- Import contacts
- Send invitations

### Week 3: Cleanup
- Follow up on invitations
- Clean up data
- Train users

### Week 4: Optimization
- Import deals
- Configure workflows
- Monitor usage

This strategy ensures a smooth transition from Freshsales to the HRX CRM system while maintaining data integrity and user relationships. 